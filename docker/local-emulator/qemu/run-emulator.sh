#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"

IMAGE_DIR="${EMULATOR_IMAGE_DIR:-$HOME/.stack/emulator/images}"
RUN_DIR="${EMULATOR_RUN_DIR:-$HOME/.stack/emulator/run}"

VM_RAM="${EMULATOR_RAM:-4096}"
VM_CPUS="${EMULATOR_CPUS:-4}"
PORT_PREFIX="${PORT_PREFIX:-${NEXT_PUBLIC_STACK_PORT_PREFIX:-81}}"
READY_TIMEOUT="${EMULATOR_READY_TIMEOUT:-240}"
# Shorter timeout when resuming from a snapshot: services are already running,
# we only need to wait for rotate-secrets + Node restart (~3-10s).
SNAPSHOT_READY_TIMEOUT="${EMULATOR_SNAPSHOT_READY_TIMEOUT:-45}"
# Set to 1 to force a cold boot and ignore any shipped savevm file.
EMULATOR_NO_SNAPSHOT="${EMULATOR_NO_SNAPSHOT:-0}"
# Skip the post-resume secret rotation. Keeps the baked placeholder secrets
# in place — acceptable for tests and CI that don't reach the emulator over
# a shared network. Shaves ~2-3s off `emulator start`.
EMULATOR_NO_ROTATION="${EMULATOR_NO_ROTATION:-0}"
# Internal: set to 1 by cmd_capture to build QEMU with the snapshot-compatible
# device layout (phantom ISOs, no virtfs, pcie-root-port, pinned 4096MB/4CPU)
# without the `-incoming defer` that resume mode adds. The captured snapshot
# must be byte-compatible with what the resume path will later feed to QEMU.
EMULATOR_CAPTURING_SNAPSHOT="${EMULATOR_CAPTURING_SNAPSHOT:-0}"
# Force re-capture even if a .savevm.zst is already present.
EMULATOR_FORCE_CAPTURE="${EMULATOR_FORCE_CAPTURE:-0}"

# Fixed host-side ports for the QEMU emulator (267xx range).
# Only user-facing services are exposed; internal deps stay inside the VM.
EMULATOR_DASHBOARD_PORT="${EMULATOR_DASHBOARD_PORT:-26700}"
EMULATOR_BACKEND_PORT="${EMULATOR_BACKEND_PORT:-26701}"
EMULATOR_MINIO_PORT="${EMULATOR_MINIO_PORT:-26702}"
EMULATOR_INBUCKET_PORT="${EMULATOR_INBUCKET_PORT:-26703}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${GREEN}[emulator]${NC} $*"; }
warn() { echo -e "${YELLOW}[emulator]${NC} $*"; }
err()  { echo -e "${RED}[emulator]${NC} $*" >&2; }
info() { echo -e "${CYAN}[emulator]${NC} $*"; }


detect_host
ARCH="${EMULATOR_ARCH:-$HOST_ARCH}"

select_accelerator() {
  local accel="tcg"
  if [ "$ARCH" = "$HOST_ARCH" ]; then
    case "$HOST_OS" in
      darwin)
        if "$(qemu_binary_for_arch "$ARCH")" -accel help 2>&1 | grep -q hvf; then
          accel="hvf"
        fi
        ;;
      linux)
        if [ -w /dev/kvm ]; then
          accel="kvm"
        fi
        ;;
    esac
  fi
  ACCEL="$accel"
}

select_accelerator

VM_DIR="$RUN_DIR/vm"

image_path() {
  echo "$IMAGE_DIR/stack-emulator-$ARCH.qcow2"
}

savevm_path() {
  echo "$IMAGE_DIR/stack-emulator-$ARCH.savevm.zst"
}

# Cached, decompressed mapped-ram file. Created on first resume from the .zst
# and reused on subsequent resumes — mapped-ram format requires a seekable
# file, so we can't stream through zstd and use multifd at the same time.
savevm_raw_path() {
  echo "$IMAGE_DIR/stack-emulator-$ARCH.savevm.raw"
}

runtime_iso_path() {
  echo "$VM_DIR/runtime-config.iso"
}

snapshot_available() {
  [ "$EMULATOR_NO_SNAPSHOT" != "1" ] && [ "$EMULATOR_CAPTURING_SNAPSHOT" != "1" ] && [ -s "$(savevm_path)" ]
}

# True when QEMU must use the snapshot-compatible device layout — either to
# resume from an existing snapshot or to capture a new one. Resume adds
# `-incoming defer`; capture does not. Everything else (phantom ISOs, no
# virtfs, pcie-root-port, pinned RAM/SMP) matches.
snapshot_layout() {
  snapshot_available || [ "$EMULATOR_CAPTURING_SNAPSHOT" = "1" ]
}

# Ensure the decompressed mapped-ram cache is up-to-date with the shipped
# .zst. Compares mtime: if .raw is older or missing, re-decompress.
ensure_savevm_raw() {
  local zst raw
  zst="$(savevm_path)"
  raw="$(savevm_raw_path)"

  local zst_ts raw_ts
  case "$HOST_OS" in
    darwin)
      zst_ts="$(stat -f '%m' "$zst" 2>/dev/null || echo 0)"
      raw_ts="$(stat -f '%m' "$raw" 2>/dev/null || echo 0)"
      ;;
    *)
      zst_ts="$(stat -c '%Y' "$zst" 2>/dev/null || echo 0)"
      raw_ts="$(stat -c '%Y' "$raw" 2>/dev/null || echo 0)"
      ;;
  esac

  if [ -s "$raw" ] && [ "$raw_ts" -ge "$zst_ts" ]; then
    return 0
  fi

  log "Decompressing snapshot cache (one-time; ~2-3GB sparse)..."
  local tmp="${raw}.tmp"
  rm -f "$tmp"
  if ! zstd -dc "$zst" > "$tmp"; then
    err "Failed to decompress $zst"
    rm -f "$tmp"
    return 1
  fi
  mv "$tmp" "$raw"
}

# Returns a fast fingerprint (size:mtime) of the base QEMU image.
# Used to detect whether the image has changed since the overlay was created.
base_image_fingerprint() {
  local img="$1"
  case "$HOST_OS" in
    darwin) stat -f "%z:%m" "$img" 2>/dev/null ;;
    linux)  stat -c "%s:%Y" "$img" 2>/dev/null ;;
    *)      stat -f "%z:%m" "$img" 2>/dev/null || stat -c "%s:%Y" "$img" 2>/dev/null ;;
  esac
}

# Fingerprint used to detect stale overlays. Includes both the base qcow2 and
# the savevm file so the overlay is rebuilt whenever either input changes. The
# overlay disk must match the disk state the snapshot was taken against for
# -incoming resume to be consistent.
runtime_fingerprint() {
  local base="$1"
  local savevm="$2"
  local base_fp savevm_fp
  base_fp="$(base_image_fingerprint "$base")"
  if [ -f "$savevm" ]; then
    savevm_fp="$(base_image_fingerprint "$savevm")"
  else
    savevm_fp="no-savevm"
  fi
  printf '%s|%s\n' "$base_fp" "$savevm_fp"
}

ensure_runtime_config_iso() {
  # When invoked via stack-cli, the CLI writes the runtime ISO natively
  # (packages/stack-cli/src/lib/iso.ts) immediately before spawning us and
  # sets STACK_EMULATOR_CLI_WROTE_ISO=1. Trust it and skip regeneration —
  # otherwise we'd fall through to make_iso_from_dir and require
  # hdiutil/mkisofs/genisoimage, which is exactly the host dep the CLI path
  # is designed to remove.
  if [ "${STACK_EMULATOR_CLI_WROTE_ISO:-}" = "1" ] && [ -s "$(runtime_iso_path)" ]; then
    return 0
  fi
  # In capture mode, cmd_capture already wrote a specialized ISO with an
  # empty STACK_EMULATOR_VM_DIR_HOST — required because virtfs is detached
  # for snapshot compatibility, and run-stack-container would otherwise
  # try to publish internal-pck to /host/... and restart-loop
  # stack.service. Trust that write and don't overwrite it.
  if [ "${EMULATOR_CAPTURING_SNAPSHOT:-}" = "1" ] && [ -s "$(runtime_iso_path)" ]; then
    return 0
  fi
  # Direct-shell invocation path: regenerate unconditionally. Port env vars
  # (PORT_PREFIX, EMULATOR_*_PORT) may have changed since the last run, and
  # an ISO cached from a prior invocation would silently override them.
  write_runtime_config_iso "$VM_DIR"
}

# Write a STACKCFG runtime-config.iso containing runtime.env + base.env.
# The VM_DIR_HOST arg is the path to publish internal-pck / stack.log to on
# /host; pass empty string to suppress publication (used by capture mode
# where /host isn't mounted — virtfs is detached for snapshot compatibility,
# so any host-side write would fail and restart-loop stack.service).
write_runtime_config_iso() {
  local vm_dir_host="$1"
  local base_env="$SCRIPT_DIR/../.env.development"
  if [ ! -f "$base_env" ]; then
    err "Cannot generate runtime config ISO: $base_env is missing."
    err "Run 'pnpm run emulator:generate-env' first, or invoke via 'stack emulator start'."
    exit 1
  fi

  local cfg_dir="$VM_DIR/runtime-config"
  rm -rf "$cfg_dir"
  mkdir -p "$cfg_dir"
  {
    printf "STACK_EMULATOR_PORT_PREFIX=%s\n" "$PORT_PREFIX"
    printf "STACK_EMULATOR_DASHBOARD_HOST_PORT=%s\n" "$EMULATOR_DASHBOARD_PORT"
    printf "STACK_EMULATOR_BACKEND_HOST_PORT=%s\n" "$EMULATOR_BACKEND_PORT"
    printf "STACK_EMULATOR_MINIO_HOST_PORT=%s\n" "$EMULATOR_MINIO_PORT"
    printf "STACK_EMULATOR_INBUCKET_HOST_PORT=%s\n" "$EMULATOR_INBUCKET_PORT"
    printf "STACK_EMULATOR_VM_DIR_HOST=%s\n" "$vm_dir_host"
  } > "$cfg_dir/runtime.env"
  cp "$base_env" "$cfg_dir/base.env"
  make_iso_from_dir "$(runtime_iso_path)" "STACKCFG" "$cfg_dir"
}

service_is_up() {
  local port="$1"
  local proto="$2"
  local path="${3:-/}"
  local expected_codes="${4:-200}"

  if [ "$proto" = "tcp" ]; then
    nc -z -w2 127.0.0.1 "$port" 2>/dev/null
    return $?
  fi

  local code
  code="$(curl -s -o /dev/null -w "%{http_code}" --max-time 2 "http://127.0.0.1:${port}${path}" 2>/dev/null || true)"
  local expected
  for expected in ${expected_codes//,/ }; do
    if [ "$code" = "$expected" ]; then
      return 0
    fi
  done
  return 1
}

deps_ready() {
  service_is_up "$EMULATOR_MINIO_PORT" http /minio/health/live &&
    service_is_up "$EMULATOR_INBUCKET_PORT" http /
}

app_ready() {
  service_is_up "$EMULATOR_BACKEND_PORT" http "/health?db=1" &&
    service_is_up "$EMULATOR_DASHBOARD_PORT" http /handler/sign-in
}

all_ready() {
  deps_ready && app_ready
}

wait_for_condition() {
  local label="$1"
  local timeout="$2"
  local check_fn="$3"
  local started=$SECONDS
  local elapsed=0

  log "Waiting for ${label}..."
  while [ "$elapsed" -lt "$timeout" ]; do
    if "$check_fn"; then
      echo ""
      log "${label} ready in ${elapsed}s"
      return 0
    fi
    sleep 0.2
    elapsed=$((SECONDS - started))
    printf "\r  [%3ds] %s..." "$elapsed" "$label"
  done
  echo ""
  return 1
}

build_qemu_cmd() {
  local base_img savevm_file
  base_img="$(image_path)"
  savevm_file="$(savevm_path)"

  if [ ! -f "$base_img" ]; then
    err "Missing QEMU image: $base_img"
    err "Run docker/local-emulator/qemu/build-image.sh $ARCH first."
    exit 1
  fi

  mkdir -p "$VM_DIR"
  local fingerprint_file="$VM_DIR/base-image.fingerprint"
  local current_fp
  current_fp="$(runtime_fingerprint "$base_img" "$savevm_file")"

  if snapshot_layout; then
    # The savevm RAM state was captured against the base image's exact disk
    # state. An overlay with writes from a previous session diverges from
    # that point, so -incoming would resume RAM against inconsistent disk.
    # Always start from a fresh overlay in the snapshot path; per-session
    # state is not preserved. Users who want persistence can opt out with
    # EMULATOR_NO_SNAPSHOT=1. Capture mode also needs a clean overlay so the
    # snapshot we write is taken against the base's known disk state.
    if [ -f "$VM_DIR/disk.qcow2" ]; then
      rm -f "$VM_DIR/disk.qcow2" "$fingerprint_file"
    fi
    qemu-img create -f qcow2 -b "$base_img" -F qcow2 "$VM_DIR/disk.qcow2" >/dev/null
    printf '%s' "$current_fp" > "$fingerprint_file"
  else
    # If the overlay was created against a different base or savevm, it will
    # diverge from the snapshot's disk state — force a rebuild.
    if [ -f "$VM_DIR/disk.qcow2" ]; then
      if [ -f "$fingerprint_file" ] && [ "$(cat "$fingerprint_file")" = "$current_fp" ]; then
        log "Reusing existing overlay disk (changes persist)"
      else
        warn "Base image or snapshot has changed — recreating overlay."
        rm -f "$VM_DIR/disk.qcow2" "$fingerprint_file"
      fi
    fi
    if [ ! -f "$VM_DIR/disk.qcow2" ]; then
      qemu-img create -f qcow2 -b "$base_img" -F qcow2 "$VM_DIR/disk.qcow2" >/dev/null
      printf '%s' "$current_fp" > "$fingerprint_file"
    fi
  fi

  local qemu_bin machine cpu firmware_args=()
  qemu_bin="$(qemu_binary_for_arch "$ARCH")"
  case "$ARCH" in
    arm64)
      machine="virt"
      cpu="max"
      local firmware
      firmware="$(find_aarch64_firmware)"
      firmware_args=(-bios "$firmware")
      ;;
    amd64)
      machine="q35"
      if [ "$ACCEL" = "tcg" ] && [ "$HOST_ARCH" != "amd64" ]; then
        cpu="qemu64"
      else
        cpu="max"
      fi
      ;;
  esac

  local netdev="user,id=net0"
  # Only expose user-facing services; internal deps stay inside the VM.
  # Bind to 127.0.0.1 so the emulator is not reachable from the LAN.
  netdev+=",hostfwd=tcp:127.0.0.1:${EMULATOR_DASHBOARD_PORT}-:${PORT_PREFIX}01"
  netdev+=",hostfwd=tcp:127.0.0.1:${EMULATOR_BACKEND_PORT}-:${PORT_PREFIX}02"
  netdev+=",hostfwd=tcp:127.0.0.1:${EMULATOR_MINIO_PORT}-:9090"
  netdev+=",hostfwd=tcp:127.0.0.1:${EMULATOR_INBUCKET_PORT}-:9001"
  # Mock OAuth server: browser redirects land on `localhost:${PORT_PREFIX}14`
  # (backend sets STACK_OAUTH_MOCK_URL to that value), so we forward host:port
  # ↔ VM:port on the same number. Collides with pnpm dev, but the two modes
  # are mutually exclusive.
  netdev+=",hostfwd=tcp:127.0.0.1:${PORT_PREFIX}14-:${PORT_PREFIX}14"

  # In snapshot-resume mode the QEMU command-line MUST match the device set
  # used at snapshot capture time, otherwise migration replay fails (broken
  # pipe / device tree mismatch). At capture time the build attaches:
  #   disk(if=virtio) + seed.iso + bundle.iso + runtime.iso (all if=virtio)
  #   netdev + virtio-net-pci + monitor + QGA virtio-serial
  #   SMP=4, RAM=4096 (pinned in build-image.sh snapshot mode)
  # We mirror that exactly. The seed/bundle ISOs were used by cloud-init at
  # build and are not needed at runtime, but their virtio-blk slots must
  # exist so the migration replay matches device IDs. Runtime-only devices
  # (virtfs, balloon) live at higher slots — extra at destination is fine.
  local snapshot_args=() runtime_only_args=() snapshot_smp="$VM_CPUS" snapshot_ram="$VM_RAM"
  if snapshot_layout; then
    if snapshot_available; then
      log "Snapshot found at $savevm_file — fast-resume enabled."
      # -incoming defer: QEMU starts, waits for a QMP migrate-incoming command.
      # We use that to set mapped-ram + multifd capabilities before loading,
      # which enables parallel RAM restore (~2-3x faster than streamed decode).
      snapshot_args+=(-incoming defer)
    else
      log "Capture mode: booting with snapshot-compatible layout (no -incoming)."
    fi
    snapshot_smp="${EMULATOR_SNAPSHOT_CPUS:-4}"
    # RAM size is baked into the snapshot; migration replay requires an
    # identical -m value. Pin to the build-time RAM (4096) and ignore
    # EMULATOR_RAM — override via EMULATOR_SNAPSHOT_RAM if a different
    # snapshot was produced.
    snapshot_ram="${EMULATOR_SNAPSHOT_RAM:-4096}"
    if [ "$snapshot_smp" != "$VM_CPUS" ]; then
      log "Pinning SMP to ${snapshot_smp} for snapshot resume (build-time value)."
    fi
    if [ "$snapshot_ram" != "$VM_RAM" ]; then
      log "Pinning RAM to ${snapshot_ram}MB for snapshot resume (ignoring EMULATOR_RAM=${VM_RAM})."
    fi

    # Tiny placeholder ISOs to match the seed.iso / bundle.iso slots present
    # at snapshot time. Their content doesn't matter (cloud-init has already
    # run); only the virtio-blk slot count must match.
    local seed_phantom="$VM_DIR/seed.phantom"
    local bundle_phantom="$VM_DIR/bundle.phantom"
    if [ ! -s "$seed_phantom" ]; then
      dd if=/dev/zero of="$seed_phantom" bs=1M count=1 status=none
    fi
    if [ ! -s "$bundle_phantom" ]; then
      dd if=/dev/zero of="$bundle_phantom" bs=1M count=1 status=none
    fi
    runtime_only_args+=(
      -drive "file=$seed_phantom,format=raw,if=virtio,readonly=on"
      -drive "file=$bundle_phantom,format=raw,if=virtio,readonly=on"
    )
  else
    # Cold-boot: include virtio-balloon and virtfs as before.
    runtime_only_args+=(
      -device virtio-balloon-pci
      -virtfs "local,path=/,mount_tag=hostfs,security_model=none"
    )
  fi

  if snapshot_layout; then
    QEMU_CMD=(
      "$qemu_bin"
      -machine "$machine"
      -accel "$ACCEL"
      -cpu "$cpu"
      "${firmware_args[@]}"
      -boot order=c
      -m "$snapshot_ram"
      -smp "$snapshot_smp"
      -drive "file=$VM_DIR/disk.qcow2,format=qcow2,if=virtio"
      "${runtime_only_args[@]}"
      -drive "file=$(runtime_iso_path),format=raw,if=virtio,readonly=on"
      -netdev "$netdev"
      -device virtio-net-pci,netdev=net0
      -chardev "socket,id=monitor,path=$VM_DIR/monitor.sock,server=on,wait=off"
      -mon "chardev=monitor,mode=control"
      -chardev "socket,path=$VM_DIR/qga.sock,server=on,wait=off,id=qga0"
      -device virtio-serial
      -device "virtserialport,chardev=qga0,name=org.qemu.guest_agent.0"
      # Empty PCIe root port reserved for runtime hot-plug of virtio-9p.
      # MUST be the last explicit -device entry — slot order has to mirror
      # build-image.sh exactly or migration replay stalls in inmigrate.
      -device "pcie-root-port,id=hostfs-port,bus=pcie.0,chassis=1"
      # Pre-create the host-side fsdev backend so the post-resume QMP
      # device_add can attach to it by id. -fsdev is host-only state — not
      # part of the migrated device tree — so it's safe to add here even
      # though the snapshot was captured without it. Going through -fsdev
      # avoids the HMP fsdev_add command, whose error path is invisible
      # via human-monitor-command (errors come back as a return string,
      # not a QMP error).
      -fsdev "local,id=hostfs,path=/,security_model=none"
      ${snapshot_args[@]+"${snapshot_args[@]}"}
      -serial "file:$VM_DIR/serial.log"
      -display none
      -daemonize
      -pidfile "$VM_DIR/qemu.pid"
    )
  else
    QEMU_CMD=(
      "$qemu_bin"
      -machine "$machine"
      -accel "$ACCEL"
      -cpu "$cpu"
      "${firmware_args[@]}"
      -boot order=c
      -m "$VM_RAM"
      -smp "$snapshot_smp"
      -drive "file=$VM_DIR/disk.qcow2,format=qcow2,if=virtio"
      -drive "file=$(runtime_iso_path),format=raw,if=virtio,readonly=on"
      -netdev "$netdev"
      -device virtio-net-pci,netdev=net0
      "${runtime_only_args[@]}"
      -chardev "socket,id=monitor,path=$VM_DIR/monitor.sock,server=on,wait=off"
      -mon "chardev=monitor,mode=control"
      -chardev "socket,path=$VM_DIR/qga.sock,server=on,wait=off,id=qga0"
      -device virtio-serial
      -device "virtserialport,chardev=qga0,name=org.qemu.guest_agent.0"
      -serial "file:$VM_DIR/serial.log"
      -display none
      -daemonize
      -pidfile "$VM_DIR/qemu.pid"
    )
  fi

}

is_running() {
  if [ ! -f "$VM_DIR/qemu.pid" ]; then
    return 1
  fi
  local pid
  pid="$(cat "$VM_DIR/qemu.pid")"
  kill -0 "$pid" 2>/dev/null
}

tail_vm_logs() {
  if [ -f "$VM_DIR/serial.log" ]; then
    echo ""
    warn "Last serial log lines:"
    tail -40 "$VM_DIR/serial.log" || true
  fi
}

ensure_ports_free() {
  local ports=("$EMULATOR_DASHBOARD_PORT" "$EMULATOR_BACKEND_PORT" "$EMULATOR_MINIO_PORT" "$EMULATOR_INBUCKET_PORT" "${PORT_PREFIX}14")
  local port
  for port in "${ports[@]}"; do
    if lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      err "Port $port is already in use. Stop any conflicting services first."
      exit 1
    fi
  done
}

start_vm() {
  mkdir -p "$VM_DIR"
  : > "$VM_DIR/serial.log"
  ensure_runtime_config_iso
  build_qemu_cmd
  "${QEMU_CMD[@]}"
}

# Send one or more QMP commands over the monitor socket. Each line of stdin is
# a JSON object; capabilities are always negotiated first. Keep stdin open
# briefly after writing so socat doesn't close before QEMU responds — QMP
# typically replies in milliseconds so 0.3s is enough.
qmp_send() {
  if [ ! -S "$VM_DIR/monitor.sock" ]; then
    return 1
  fi
  local payload
  payload="$(cat)"
  {
    printf '%s\n' '{"execute":"qmp_capabilities"}'
    printf '%s\n' "$payload"
    sleep 0.3
  } | socat -t5 - "UNIX-CONNECT:$VM_DIR/monitor.sock" 2>/dev/null
}

# After -incoming defer, QEMU waits for a migrate-incoming command. This sets
# up mapped-ram + multifd capabilities and kicks off the RAM load from the
# decompressed cache file. Returns once the VM is running.
qmp_incoming_and_cont() {
  local raw_file="$1"

  # Set caps + parameters before migrate-incoming, same as source.
  local setup_resp
  setup_resp=$( {
    printf '%s\n' '{"execute":"migrate-set-capabilities","arguments":{"capabilities":[{"capability":"mapped-ram","state":true},{"capability":"multifd","state":true}]}}'
    printf '%s\n' '{"execute":"migrate-set-parameters","arguments":{"multifd-channels":4}}'
  } | qmp_send)
  if printf '%s' "$setup_resp" | grep -q '"error"'; then
    err "QMP caps setup failed: $setup_resp"
    return 1
  fi

  # Kick off the incoming migration from the mapped-ram file.
  local inc_cmd inc_resp
  inc_cmd=$(printf '{"execute":"migrate-incoming","arguments":{"uri":"file:%s"}}' "$raw_file")
  inc_resp=$(printf '%s\n' "$inc_cmd" | qmp_send)
  if printf '%s' "$inc_resp" | grep -q '"error"'; then
    err "QMP migrate-incoming failed: $inc_resp"
    return 1
  fi

  # Poll until status reaches a runnable state, then cont.
  local deadline=$((SECONDS + 60))
  while [ "$SECONDS" -lt "$deadline" ]; do
    local out status
    out=$(printf '%s\n' '{"execute":"query-status"}' | qmp_send || true)
    status=$(printf '%s' "$out" | grep -o '"status"[[:space:]]*:[[:space:]]*"[a-z-]*"' | head -1 | sed -E 's/.*"([a-z-]+)".*/\1/')
    case "$status" in
      running)
        return 0
        ;;
      paused|postmigrate|prelaunch)
        printf '%s\n' '{"execute":"cont"}' | qmp_send >/dev/null || true
        return 0
        ;;
      inmigrate|"")
        ;;
      *)
        log "unexpected QMP status: $status"
        ;;
    esac
    sleep 0.2
  done
  return 1
}

# Placeholder PCK baked into the snapshot. Kept in sync with the value in
# docker/local-emulator/qemu/cloud-init/emulator/user-data.
SNAPSHOT_PLACEHOLDER_PCK="00000000000000000000000000000000ffffffffffffffffffffffffffffffff"

# Write the internal PCK to the host path the CLI reads (see
# readInternalPck() in packages/stack-cli/src/commands/emulator.ts). In
# cold-boot mode the guest publishes this via virtfs/9p, but snapshot mode
# drops virtfs, so the host has to write it itself.
write_internal_pck_for_cli() {
  local pck="$1"
  (umask 077 && printf '%s' "$pck" > "$VM_DIR/internal-pck")
}

# Drive qemu-guest-agent via its virtserialport socket. QGA speaks the same
# JSON protocol as QMP but over a separate channel. We use guest-sync to make
# sure the agent is responsive, then guest-exec to fire trigger-fast-rotate.
qga_send() {
  if [ ! -S "$VM_DIR/qga.sock" ]; then
    return 1
  fi
  # socat closes the connection on stdin EOF before QGA can reply, so keep
  # stdin open for a short window after writing the request to give the
  # agent time to respond. QGA replies in milliseconds; the only reason this
  # isn't 0.1s is to absorb scheduling jitter on a busy host.
  local payload
  payload="$(cat)"
  ( printf '%s\n' "$payload"; sleep 0.5 ) | socat -t10 - "UNIX-CONNECT:$VM_DIR/qga.sock" 2>/dev/null
}

qga_wait_ready() {
  local deadline=$((SECONDS + 30))
  while [ "$SECONDS" -lt "$deadline" ]; do
    local resp
    resp=$(printf '%s\n' '{"execute":"guest-sync","arguments":{"id":424242}}' | qga_send || true)
    if printf '%s' "$resp" | grep -q '"return":[[:space:]]*424242'; then
      return 0
    fi
    sleep 0.2
  done
  return 1
}

# Hot-plug a virtio-9p device backed by host `/` after a snapshot resume.
# The snapshot was captured WITHOUT virtfs (QEMU disallows migration while
# 9p is mounted in the guest), so the resumed VM has no host filesystem
# available until we add one here. The fsdev backend was pre-created by
# the -fsdev option in build_qemu_cmd; we only need the device_add half.
qmp_hotplug_9p() {
  local resp
  resp=$(printf '%s\n' \
    '{"execute":"device_add","arguments":{"driver":"virtio-9p-pci","id":"hostfs-dev","fsdev":"hostfs","mount_tag":"hostfs","bus":"hostfs-port"}}' \
    | qmp_send)
  if printf '%s' "$resp" | grep -q '"error"'; then
    err "QMP device_add virtio-9p-pci failed: $resp"
    return 1
  fi
  return 0
}

# Run /usr/local/bin/mount-host-fs --post-resume in the guest. The script
# mounts the freshly-hot-plugged 9p device on /host, which is a shared
# mount point — so the new mount propagates into the running stack
# container's `-v /host:/host:rshared` bind mount without a container
# restart.
qga_mount_host_fs() {
  local cmd resp pid status_resp exited exitcode
  cmd='{"execute":"guest-exec","arguments":{"path":"/usr/local/bin/mount-host-fs","arg":["--post-resume"],"capture-output":true}}'
  resp=$(printf '%s\n' "$cmd" | qga_send || true)
  pid=$(printf '%s' "$resp" | grep -o '"pid"[[:space:]]*:[[:space:]]*[0-9]*' | head -1 | sed -E 's/.*:[[:space:]]*([0-9]+).*/\1/')
  if [ -z "$pid" ]; then
    err "guest-exec mount-host-fs did not return a pid; response: $resp"
    return 1
  fi
  local deadline=$((SECONDS + 20))
  while [ "$SECONDS" -lt "$deadline" ]; do
    status_resp=$(printf '%s\n' "{\"execute\":\"guest-exec-status\",\"arguments\":{\"pid\":${pid}}}" | qga_send || true)
    exited=$(printf '%s' "$status_resp" | grep -o '"exited"[[:space:]]*:[[:space:]]*\(true\|false\)' | head -1 | sed -E 's/.*:[[:space:]]*(true|false).*/\1/')
    if [ "$exited" = "true" ]; then
      exitcode=$(printf '%s' "$status_resp" | grep -o '"exitcode"[[:space:]]*:[[:space:]]*-\{0,1\}[0-9]*' | head -1 | sed -E 's/.*:[[:space:]]*(-?[0-9]+).*/\1/')
      if [ "${exitcode:-0}" = "0" ]; then
        log "host fs mounted in guest"
        return 0
      fi
      err "mount-host-fs exited with code ${exitcode:-unknown}; response: $status_resp"
      return 1
    fi
    sleep 0.2
  done
  err "mount-host-fs did not complete within 20s"
  return 1
}

qga_trigger_fast_rotate() {
  # guest-exec returns a pid; we then poll guest-exec-status until the
  # process exits, and surface its exit code. Capture output so a failure
  # message is available in serial.log. We pipe the fresh-secrets env file
  # (as base64) to the script via input-data — keeps secrets off the
  # filesystem and avoids needing virtfs.
  local fresh_pck fresh_ssk fresh_sak fresh_cron payload secrets_b64 resp pid
  fresh_pck="$(openssl rand -hex 32)"
  fresh_ssk="$(openssl rand -hex 32)"
  fresh_sak="$(openssl rand -hex 32)"
  fresh_cron="$(openssl rand -hex 32)"
  payload=$(
    printf 'STACK_SEED_INTERNAL_PROJECT_PUBLISHABLE_CLIENT_KEY=%s\n' "$fresh_pck"
    printf 'STACK_SEED_INTERNAL_PROJECT_SECRET_SERVER_KEY=%s\n' "$fresh_ssk"
    printf 'STACK_SEED_INTERNAL_PROJECT_SUPER_SECRET_ADMIN_KEY=%s\n' "$fresh_sak"
    printf 'CRON_SECRET=%s\n' "$fresh_cron"
  )
  # Publish the fresh PCK to the host path the CLI reads. Writing before the
  # guest-exec so a --config-file flow that polls from another process can
  # pick it up the moment rotation completes.
  write_internal_pck_for_cli "$fresh_pck"
  secrets_b64=$(printf '%s' "$payload" | base64 | tr -d '\n')
  local cmd
  cmd=$(printf '{"execute":"guest-exec","arguments":{"path":"/usr/local/bin/trigger-fast-rotate","capture-output":true,"input-data":"%s"}}' "$secrets_b64")
  resp=$(printf '%s\n' "$cmd" | qga_send || true)
  pid=$(printf '%s' "$resp" | grep -o '"pid"[[:space:]]*:[[:space:]]*[0-9]*' | head -1 | sed -E 's/.*:[[:space:]]*([0-9]+).*/\1/')
  if [ -z "$pid" ]; then
    err "guest-exec did not return a pid; response: $resp"
    return 1
  fi

  # Rotation (sed + UPDATE + supervisorctl restart + node startup) fits well
  # inside this window.
  local deadline=$((SECONDS + 60))
  while [ "$SECONDS" -lt "$deadline" ]; do
    local status_resp exited exitcode
    status_resp=$(printf '%s\n' "{\"execute\":\"guest-exec-status\",\"arguments\":{\"pid\":${pid}}}" | qga_send || true)
    exited=$(printf '%s' "$status_resp" | grep -o '"exited"[[:space:]]*:[[:space:]]*\(true\|false\)' | head -1 | sed -E 's/.*:[[:space:]]*(true|false).*/\1/')
    if [ "$exited" = "true" ]; then
      exitcode=$(printf '%s' "$status_resp" | grep -o '"exitcode"[[:space:]]*:[[:space:]]*-\{0,1\}[0-9]*' | head -1 | sed -E 's/.*:[[:space:]]*(-?[0-9]+).*/\1/')
      if [ "${exitcode:-0}" = "0" ]; then
        log "rotate-secrets completed."
        return 0
      fi
      err "rotate-secrets exited with code ${exitcode:-unknown}"
      err "response: $status_resp"
      return 1
    fi
    sleep 0.2
  done
  err "rotate-secrets did not complete within 60s"
  return 1
}

stop_vm() {
  if [ ! -f "$VM_DIR/qemu.pid" ]; then
    return 0
  fi
  local pid
  pid="$(cat "$VM_DIR/qemu.pid")"
  if kill -0 "$pid" 2>/dev/null; then
    if [ -S "$VM_DIR/monitor.sock" ]; then
      echo '{"execute":"qmp_capabilities"}' | socat - UNIX-CONNECT:"$VM_DIR/monitor.sock" >/dev/null 2>&1 || true
      echo '{"execute":"system_powerdown"}' | socat - UNIX-CONNECT:"$VM_DIR/monitor.sock" >/dev/null 2>&1 || true
      sleep 3
    fi
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      sleep 1
      kill -9 "$pid" 2>/dev/null || true
    fi
  fi
  rm -f "$VM_DIR/qemu.pid" "$VM_DIR/monitor.sock" "$VM_DIR/qga.sock" "$VM_DIR/serial.log"
  # runtime-config.iso is left in place; ensure_runtime_config_iso regenerates
  # it on the next start. `cmd_reset` wipes $RUN_DIR entirely when a full reset
  # is wanted.
}

cmd_start() {
  ensure_ports_free
  mkdir -p "$RUN_DIR"

  info "Starting QEMU local emulator"
  info "Arch: $ARCH | Accel: $ACCEL"
  info "Ports: Dashboard=$EMULATOR_DASHBOARD_PORT Backend=$EMULATOR_BACKEND_PORT MinIO=$EMULATOR_MINIO_PORT Inbucket=$EMULATOR_INBUCKET_PORT"

  local using_snapshot=0
  if snapshot_available; then
    if ! ensure_savevm_raw; then
      warn "Snapshot decompression failed — falling back to cold boot."
      snapshot_fallback_to_cold_boot
      return
    fi
    using_snapshot=1
  fi

  start_vm

  info "VM: ${VM_RAM}MB / ${VM_CPUS} CPUs"

  if [ "$using_snapshot" = "1" ]; then
    log "Resuming from snapshot (mapped-ram + multifd)..."
    if ! qmp_incoming_and_cont "$(savevm_raw_path)"; then
      warn "Snapshot resume did not reach a runnable state — falling back to cold boot."
      snapshot_fallback_to_cold_boot
      return
    fi

    log "VM resumed; waiting for guest agent..."
    if ! qga_wait_ready; then
      warn "Guest agent did not respond — falling back to cold boot."
      snapshot_fallback_to_cold_boot
      return
    fi

    # Hot-plug the host filesystem. The snapshot was captured without
    # virtfs, so the running container has an empty /host bind mount until
    # we add the 9p device and mount it in the guest. Required for routes
    # like /local-emulator/project that read user-supplied paths via /host.
    log "Hot-plugging host filesystem..."
    if ! qmp_hotplug_9p; then
      warn "Failed to hot-plug 9p device — falling back to cold boot."
      snapshot_fallback_to_cold_boot
      return
    fi
    if ! qga_mount_host_fs; then
      warn "Failed to mount host fs in guest — falling back to cold boot."
      snapshot_fallback_to_cold_boot
      return
    fi

    if [ "$EMULATOR_NO_ROTATION" = "1" ]; then
      warn "EMULATOR_NO_ROTATION=1: snapshot's placeholder secrets are in effect — do not expose this instance."
      # The placeholder PCK is live in the running image; publish it to the
      # host path so --config-file flows still work.
      write_internal_pck_for_cli "$SNAPSHOT_PLACEHOLDER_PCK"
      if ! wait_for_condition "services" "$SNAPSHOT_READY_TIMEOUT" all_ready; then
        warn "Services did not respond after resume — falling back to cold boot."
        tail_vm_logs
        snapshot_fallback_to_cold_boot
        return
      fi
    else
      log "Generating fresh secrets + triggering rotation..."
      if ! qga_trigger_fast_rotate; then
        warn "Failed to trigger rotate-secrets — falling back to cold boot."
        snapshot_fallback_to_cold_boot
        return
      fi

      # Wait for the *new* backend (post-supervisor-restart) to actually be
      # listening. all_ready may briefly return true against the OLD Node
      # processes between when supervisor sends SIGTERM and when the children
      # die; sleep a beat so we measure the real readiness.
      sleep 1
      if ! wait_for_condition "rotated services" "$SNAPSHOT_READY_TIMEOUT" all_ready; then
        warn "Services did not recover after rotation — falling back to cold boot."
        tail_vm_logs
        snapshot_fallback_to_cold_boot
        return
      fi
    fi
  else
    if ! wait_for_condition "deps services" "$READY_TIMEOUT" deps_ready; then
      tail_vm_logs
      exit 1
    fi

    if ! wait_for_condition "dashboard/backend" "$READY_TIMEOUT" app_ready; then
      tail_vm_logs
      exit 1
    fi
  fi

  log "All services are green."
  info "Dashboard: http://localhost:${EMULATOR_DASHBOARD_PORT}"
  info "Backend:   http://localhost:${EMULATOR_BACKEND_PORT}"
}

# If anything about the snapshot resume fails, stop the VM, wipe the overlay,
# and retry as a cold boot. Keeps the user unblocked even when the snapshot is
# broken (e.g. stale, incompatible host-arch/QEMU-version mismatch).
snapshot_fallback_to_cold_boot() {
  warn "Retrying with cold boot (EMULATOR_NO_SNAPSHOT=1)..."
  stop_vm
  # Wipe the overlay + fingerprint so build_qemu_cmd re-creates a fresh one.
  # runtime-config.iso is regenerated by ensure_runtime_config_iso on recursion.
  rm -f "$VM_DIR/disk.qcow2" "$VM_DIR/base-image.fingerprint" \
        "$VM_DIR/seed.phantom" "$VM_DIR/bundle.phantom"
  EMULATOR_NO_SNAPSHOT=1
  cmd_start
}

cmd_stop() {
  stop_vm
  log "QEMU emulator stopped."
}

cmd_reset() {
  cmd_stop 2>/dev/null || true
  rm -rf "$RUN_DIR"
  log "Emulator state reset. Next start will be a fresh boot."
}

# Cold-boot the VM with the snapshot-compatible device layout, wait for all
# services to be healthy, then capture a snapshot via QMP migrate and compress
# it to .savevm.zst. Called by `stack emulator pull` so first-run users get a
# fast-resume snapshot that's guaranteed compatible with their host's QEMU
# version + accelerator (which CI-built snapshots can't guarantee across
# KVM/HVF/TCG).
cmd_capture() {
  if [ ! -f "$(image_path)" ]; then
    err "Missing qcow2: $(image_path). Run 'stack emulator pull' first."
    exit 1
  fi
  if [ -s "$(savevm_path)" ] && [ "$EMULATOR_FORCE_CAPTURE" != "1" ]; then
    log "Snapshot already present at $(savevm_path); skipping capture."
    log "Pass EMULATOR_FORCE_CAPTURE=1 to rebuild it."
    return 0
  fi
  if is_running; then
    err "Emulator is already running; stop it first (stack emulator stop)."
    exit 1
  fi

  # Start with a clean slate if we're force-recapturing; stale raw/zst would
  # otherwise make snapshot_available() return true and flip QEMU into
  # -incoming defer mode.
  rm -f "$(savevm_path)" "$(savevm_raw_path)"

  ensure_ports_free
  mkdir -p "$RUN_DIR" "$VM_DIR"
  # Regenerate runtime-config.iso with STACK_EMULATOR_VM_DIR_HOST empty —
  # virtfs is detached in capture mode, so run-stack-container's
  # `install internal-pck → /host/$VM_DIR_HOST/...` would fail and restart-loop
  # stack.service. Mirrors build-image.sh's CI runtime.env shape.
  rm -f "$(runtime_iso_path)"
  write_runtime_config_iso ""

  info "Cold-booting VM to capture local snapshot (one-time, ~1-3 min)..."
  EMULATOR_CAPTURING_SNAPSHOT=1
  start_vm
  info "VM: 4096MB / 4 CPUs (pinned for snapshot compatibility)"

  # Cold boot with snapshot-compatible layout drops virtfs, so stack.service
  # starts without /host mounted — fine for capture; hostfs is hot-plugged on
  # resume via qmp_hotplug_9p.
  if ! wait_for_condition "all services" "$READY_TIMEOUT" all_ready; then
    tail_vm_logs
    stop_vm
    err "Services did not come up; capture aborted."
    exit 1
  fi

  local raw tmp_raw zst tmp_zst
  raw="$(savevm_raw_path)"
  tmp_raw="${raw}.capture.tmp"
  zst="$(savevm_path)"
  tmp_zst="${zst}.capture.tmp"
  rm -f "$tmp_raw" "$tmp_zst"

  log "Capturing VM state via QMP (mapped-ram + multifd)..."
  if ! capture_vm_state "$VM_DIR/monitor.sock" "$tmp_raw"; then
    err "QMP capture failed."
    stop_vm
    exit 1
  fi

  # capture_vm_state sent QMP quit; wait for QEMU to exit, then clean sockets.
  local waited=0
  while [ "$waited" -lt 30 ] && is_running; do
    sleep 1
    waited=$((waited + 1))
  done
  if is_running; then
    warn "QEMU did not exit after QMP quit; forcing."
    stop_vm
  fi
  rm -f "$VM_DIR/qemu.pid" "$VM_DIR/monitor.sock" "$VM_DIR/qga.sock"

  if [ ! -s "$tmp_raw" ]; then
    err "Captured raw file is empty: $tmp_raw"
    exit 1
  fi

  log "Compressing snapshot with zstd..."
  zstd -1 -T0 -f -o "$tmp_zst" "$tmp_raw"
  mv "$tmp_zst" "$zst"
  # Keep the uncompressed file too — resume reads it directly via mapped-ram,
  # and ensure_savevm_raw skips re-decompression when the raw's mtime >= zst's.
  mv "$tmp_raw" "$raw"
  touch -r "$zst" "$raw"

  local size
  size="$(du -h "$zst" | cut -f1)"
  log "Snapshot captured: $zst (${size})"
}

STATUS_FAILED=0

print_service_status() {
  local name="$1"
  local port="$2"
  local proto="$3"
  local path="${4:-/}"
  local expected_codes="${5:-200}"
  if service_is_up "$port" "$proto" "$path" "$expected_codes"; then
    echo -e "  ${GREEN}●${NC} $name (:$port)"
  else
    echo -e "  ${RED}●${NC} $name (:$port)"
    STATUS_FAILED=1
  fi
}

cmd_status() {
  STATUS_FAILED=0
  echo "VM:"
  if is_running; then
    echo -e "  ${GREEN}●${NC} emulator"
  else
    echo -e "  ${RED}●${NC} emulator"
    STATUS_FAILED=1
  fi
  echo ""
  echo "Services:"
  print_service_status "Dashboard" "$EMULATOR_DASHBOARD_PORT" http /handler/sign-in
  print_service_status "Backend" "$EMULATOR_BACKEND_PORT" http "/health?db=1"
  print_service_status "MinIO" "$EMULATOR_MINIO_PORT" http /minio/health/live
  print_service_status "Inbucket HTTP" "$EMULATOR_INBUCKET_PORT" http /
  exit "$STATUS_FAILED"
}

cmd_bench() {
  local elapsed
  cmd_stop >/dev/null 2>&1 || true
  SECONDS=0
  cmd_start
  elapsed="$SECONDS"
  printf "Startup time: %.1fs\n" "$elapsed"
}

ACTION="start"

while [[ $# -gt 0 ]]; do
  case "$1" in
    start|stop|reset|status|bench|capture)
      ACTION="$1"
      shift
      ;;
    *)
      echo "Usage: $0 [start|stop|reset|status|bench|capture]"
      exit 1
      ;;
  esac
done

case "$ACTION" in
  start) cmd_start ;;
  stop) cmd_stop ;;
  reset) cmd_reset ;;
  status) cmd_status ;;
  bench) cmd_bench ;;
  capture) cmd_capture ;;
esac
