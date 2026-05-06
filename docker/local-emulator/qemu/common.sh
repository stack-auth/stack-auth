#!/usr/bin/env bash
# Shared helpers for QEMU emulator scripts.
# Source this file; do not execute it directly.

AARCH64_FIRMWARE_PATHS=(
  /opt/homebrew/share/qemu/edk2-aarch64-code.fd
  /usr/share/qemu/edk2-aarch64-code.fd
  /usr/share/AAVMF/AAVMF_CODE.fd
  /usr/share/qemu-efi-aarch64/QEMU_EFI.fd
)

detect_host() {
  case "$(uname -m)" in
    arm64|aarch64) HOST_ARCH="arm64" ;;
    x86_64|amd64)  HOST_ARCH="amd64" ;;
    *) echo "Unsupported host architecture: $(uname -m)" >&2; exit 1 ;;
  esac

  case "$(uname -s)" in
    Darwin)              HOST_OS="darwin" ;;
    Linux)               HOST_OS="linux" ;;
    MINGW*|MSYS*|CYGWIN*) HOST_OS="windows" ;;
    *)                   HOST_OS="unknown" ;;
  esac
}

qemu_binary_for_arch() {
  case "$1" in
    arm64) echo "qemu-system-aarch64" ;;
    amd64) echo "qemu-system-x86_64" ;;
    *) return 1 ;;
  esac
}

find_aarch64_firmware() {
  local p
  for p in "${AARCH64_FIRMWARE_PATHS[@]}"; do
    if [ -f "$p" ]; then
      echo "$p"
      return 0
    fi
  done
  echo "No aarch64 UEFI firmware found." >&2
  return 1
}

make_iso_from_dir() {
  local iso_path="$1"
  local volume_name="$2"
  local source_dir="$3"

  rm -f "$iso_path" "${iso_path}.iso"
  if command -v hdiutil >/dev/null 2>&1; then
    local tmp_dir
    tmp_dir="$(mktemp -d /tmp/stack-emulator-iso-XXXXXX)"
    cp -R "$source_dir/." "$tmp_dir/"
    hdiutil makehybrid -o "$iso_path" "$tmp_dir" -joliet -iso -default-volume-name "$volume_name" 2>/dev/null
    if [ -f "${iso_path}.iso" ]; then
      mv "${iso_path}.iso" "$iso_path"
    fi
    rm -rf "$tmp_dir"
  elif command -v mkisofs >/dev/null 2>&1; then
    mkisofs -output "$iso_path" -volid "$volume_name" -joliet -rock "$source_dir" >/dev/null 2>&1
  elif command -v genisoimage >/dev/null 2>&1; then
    genisoimage -output "$iso_path" -volid "$volume_name" -joliet -rock "$source_dir" >/dev/null 2>&1
  else
    echo "Missing ISO creation tool (need hdiutil, mkisofs, or genisoimage)" >&2
    exit 1
  fi
}

# Send one or more QMP commands over the monitor socket. Stdin is a stream of
# JSON objects; qmp_capabilities is always sent first to exit negotiation mode.
# Keep stdin open briefly after writing so socat doesn't close before QEMU
# responds — QMP replies in milliseconds so 0.5s is plenty.
#
# Callers: build-image.sh capture flow, run-emulator.sh cmd_capture.
qmp_session() {
  local sock="$1"
  local payload
  payload="$(cat)"
  ( printf '%s\n' "$payload"; sleep 0.5 ) | socat -t30 - "UNIX-CONNECT:${sock}"
}

# Drive the snapshot capture over QMP:
#   1. qmp_capabilities — exit negotiation mode.
#   2. stop — pause the VM so no more disk writes happen.
#   3. migrate-set-capabilities — enable mapped-ram + multifd for fast resume.
#   4. migrate to file:<path> — streams RAM/device state out.
#   5. Poll query-migrate until status=completed (or failed).
#   6. quit — terminate QEMU cleanly.
#
# Depends on log/err/warn being defined by the sourcing script.
capture_vm_state() {
  local sock="$1"
  local guest_path="$2"

  if [ ! -S "$sock" ]; then
    err "QMP monitor socket missing: $sock"
    return 1
  fi

  log "  QMP: stopping VM..."
  {
    printf '%s\n' '{"execute":"qmp_capabilities"}'
    printf '%s\n' '{"execute":"stop"}'
  } | qmp_session "$sock" >/dev/null || {
    err "QMP stop failed"
    return 1
  }

  log "  QMP: enabling mapped-ram + multifd for fast resume..."
  # mapped-ram: writes each RAM page to a fixed offset in the output file
  # (vs the legacy streamed format). This lets the target QEMU mmap the file
  # and fault pages lazily — and combined with multifd, load RAM in parallel.
  # multifd-channels=4 matches our pinned SMP so the channels don't starve
  # each other on the target's 4 vCPUs.
  local caps_cmd params_cmd
  caps_cmd='{"execute":"migrate-set-capabilities","arguments":{"capabilities":[{"capability":"mapped-ram","state":true},{"capability":"multifd","state":true}]}}'
  params_cmd='{"execute":"migrate-set-parameters","arguments":{"multifd-channels":4}}'
  local setup_resp
  setup_resp=$({
    printf '%s\n' '{"execute":"qmp_capabilities"}'
    printf '%s\n' "$caps_cmd"
    printf '%s\n' "$params_cmd"
  } | qmp_session "$sock") || {
    err "QMP capabilities setup failed"
    return 1
  }
  if printf '%s' "$setup_resp" | grep -q '"error"[[:space:]]*:'; then
    err "QMP capabilities returned error: $setup_resp"
    return 1
  fi

  log "  QMP: migrating RAM state to ${guest_path}..."
  # Use file: migration (native QEMU) instead of exec: to avoid relying on a
  # spawned shell finding zstd in PATH. Compressed as a separate host step
  # after migrate completes.
  local migrate_cmd
  migrate_cmd=$(printf '{"execute":"migrate","arguments":{"uri":"file:%s"}}' "$guest_path")
  local migrate_resp
  migrate_resp=$({
    printf '%s\n' '{"execute":"qmp_capabilities"}'
    printf '%s\n' "$migrate_cmd"
  } | qmp_session "$sock") || {
    err "QMP migrate failed"
    return 1
  }
  if printf '%s' "$migrate_resp" | grep -q '"error"[[:space:]]*:'; then
    err "QMP migrate returned error: $migrate_resp"
    return 1
  fi

  # Poll migration status. Migration runs in the background after the
  # migrate command returns; we watch for "completed" or "failed".
  local migrate_timeout=600
  local waited=0
  local last_heartbeat=0
  while [ "$waited" -lt "$migrate_timeout" ]; do
    local status_line status
    status_line=$({
      printf '%s\n' '{"execute":"qmp_capabilities"}'
      printf '%s\n' '{"execute":"query-migrate"}'
    } | qmp_session "$sock" 2>/dev/null || true)
    status="$(printf '%s\n' "$status_line" | grep -o '"status"[[:space:]]*:[[:space:]]*"[a-z-]*"' | head -1 | sed -E 's/.*"([a-z-]+)".*/\1/')"
    case "$status" in
      completed)
        log "  QMP: migrate completed (${waited}s)"
        break
        ;;
      failed|cancelled)
        err "  QMP: migrate ended with status=$status"
        err "  QMP response: $status_line"
        return 1
        ;;
      active|setup|device|"")
        # still running
        if [ "$((waited - last_heartbeat))" -ge 30 ]; then
          local transferred
          transferred=$(printf '%s' "$status_line" | grep -o '"transferred"[[:space:]]*:[[:space:]]*[0-9]*' | head -1 | sed -E 's/.*:[[:space:]]*([0-9]+).*/\1/')
          log "  QMP: migrate in progress (${waited}s, status=${status:-init}, transferred=${transferred:-0})"
          last_heartbeat=$waited
        fi
        ;;
      *)
        log "  QMP: migrate status=$status (${waited}s)"
        ;;
    esac
    sleep 2
    waited=$((waited + 2))
  done

  if [ "$waited" -ge "$migrate_timeout" ]; then
    err "QMP migrate timed out after ${migrate_timeout}s"
    err "Last query-migrate response: $({
      printf '%s\n' '{"execute":"qmp_capabilities"}'
      printf '%s\n' '{"execute":"query-migrate"}'
    } | qmp_session "$sock" 2>/dev/null || true)"
    return 1
  fi

  log "  QMP: quitting VM..."
  {
    printf '%s\n' '{"execute":"qmp_capabilities"}'
    printf '%s\n' '{"execute":"quit"}'
  } | qmp_session "$sock" >/dev/null || true

  return 0
}
