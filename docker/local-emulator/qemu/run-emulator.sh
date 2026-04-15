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

runtime_iso_path() {
  echo "$VM_DIR/runtime-config.iso"
}

snapshot_available() {
  [ "$EMULATOR_NO_SNAPSHOT" != "1" ] && [ -s "$(savevm_path)" ]
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

prepare_runtime_config_iso() {
  local cfg_dir="$VM_DIR/runtime-config"
  local cfg_iso
  cfg_iso="$(runtime_iso_path)"
  rm -rf "$cfg_dir"
  mkdir -p "$cfg_dir"
  {
    printf "STACK_EMULATOR_PORT_PREFIX=%s\n" "$PORT_PREFIX"
    printf "STACK_EMULATOR_DASHBOARD_HOST_PORT=%s\n" "$EMULATOR_DASHBOARD_PORT"
    printf "STACK_EMULATOR_BACKEND_HOST_PORT=%s\n" "$EMULATOR_BACKEND_PORT"
    printf "STACK_EMULATOR_MINIO_HOST_PORT=%s\n" "$EMULATOR_MINIO_PORT"
    printf "STACK_EMULATOR_INBUCKET_HOST_PORT=%s\n" "$EMULATOR_INBUCKET_PORT"
    printf "STACK_EMULATOR_VM_DIR_HOST=%s\n" "$VM_DIR"
  } > "$cfg_dir/runtime.env"
  cp "$SCRIPT_DIR/../.env.development" "$cfg_dir/base.env"
  make_iso_from_dir "$cfg_iso" "STACKCFG" "$cfg_dir"
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
    sleep 1
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

  if snapshot_available; then
    # The savevm RAM state was captured against the base image's exact disk
    # state. An overlay with writes from a previous session diverges from
    # that point, so -incoming would resume RAM against inconsistent disk.
    # Always start from a fresh overlay in the snapshot path; per-session
    # state is not preserved. Users who want persistence can opt out with
    # EMULATOR_NO_SNAPSHOT=1.
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
  local snapshot_args=() runtime_only_args=() snapshot_smp="$VM_CPUS"
  if snapshot_available; then
    log "Snapshot found at $savevm_file — fast-resume enabled."
    snapshot_args+=(-incoming "exec:zstd -dc $savevm_file")
    snapshot_smp="${EMULATOR_SNAPSHOT_CPUS:-4}"
    if [ "$snapshot_smp" != "$VM_CPUS" ]; then
      log "Pinning SMP to ${snapshot_smp} for snapshot resume (build-time value)."
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

  if snapshot_available; then
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
      "${runtime_only_args[@]}"
      -drive "file=$(runtime_iso_path),format=raw,if=virtio,readonly=on"
      -netdev "$netdev"
      -device virtio-net-pci,netdev=net0
      -chardev "socket,id=monitor,path=$VM_DIR/monitor.sock,server=on,wait=off"
      -mon "chardev=monitor,mode=control"
      -chardev "socket,path=$VM_DIR/qga.sock,server=on,wait=off,id=qga0"
      -device virtio-serial
      -device "virtserialport,chardev=qga0,name=org.qemu.guest_agent.0"
      "${snapshot_args[@]}"
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
  prepare_runtime_config_iso
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

# After -incoming, QEMU is in "inmigrate" until the entire migration stream has
# been received. Sending `cont` mid-migration would abort it (the host-side
# decompressor / pipe gets killed). Wait for the VM to reach a runnable state
# (paused / postmigrate / prelaunch / running) before continuing.
qmp_wait_for_paused_and_continue() {
  local deadline=$((SECONDS + 120))
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
        # still loading migration data
        ;;
      *)
        log "unexpected QMP status: $status"
        ;;
    esac
    sleep 0.2
  done
  return 1
}

# Generate fresh per-install secrets on the host. We pass them to the guest
# through QGA's guest-exec input-data field (base64-encoded), so no host file
# or virtfs mount is needed in the snapshot path.
generate_fresh_secrets_payload() {
  printf 'STACK_SEED_INTERNAL_PROJECT_PUBLISHABLE_CLIENT_KEY=%s\n' "$(openssl rand -hex 32)"
  printf 'STACK_SEED_INTERNAL_PROJECT_SECRET_SERVER_KEY=%s\n' "$(openssl rand -hex 32)"
  printf 'STACK_SEED_INTERNAL_PROJECT_SUPER_SECRET_ADMIN_KEY=%s\n' "$(openssl rand -hex 32)"
  printf 'CRON_SECRET=%s\n' "$(openssl rand -hex 32)"
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

qga_trigger_fast_rotate() {
  # guest-exec returns a pid; we then poll guest-exec-status until the
  # process exits, and surface its exit code. Capture output so a failure
  # message is available in serial.log. We pipe the fresh-secrets env file
  # (as base64) to the script via input-data — keeps secrets off the
  # filesystem and avoids needing virtfs.
  local secrets_b64 resp pid
  secrets_b64=$(generate_fresh_secrets_payload | base64 | tr -d '\n')
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
  rm -f "$VM_DIR/qemu.pid" "$VM_DIR/monitor.sock" "$VM_DIR/serial.log"
  rm -rf "$VM_DIR/runtime-config"
  rm -f "$VM_DIR/runtime-config.iso"
}

cmd_start() {
  ensure_ports_free
  mkdir -p "$RUN_DIR"

  info "Starting QEMU local emulator"
  info "Arch: $ARCH | Accel: $ACCEL"
  info "Ports: Dashboard=$EMULATOR_DASHBOARD_PORT Backend=$EMULATOR_BACKEND_PORT MinIO=$EMULATOR_MINIO_PORT Inbucket=$EMULATOR_INBUCKET_PORT"

  local using_snapshot=0
  if snapshot_available; then
    using_snapshot=1
  fi

  start_vm

  info "VM: ${VM_RAM}MB / ${VM_CPUS} CPUs"

  if [ "$using_snapshot" = "1" ]; then
    log "Resuming from snapshot..."
    if ! qmp_wait_for_paused_and_continue; then
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
  rm -rf "$VM_DIR"
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
    start|stop|reset|status|bench)
      ACTION="$1"
      shift
      ;;
    *)
      echo "Usage: $0 [start|stop|reset|status|bench]"
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
esac
