#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"

IMAGE_DIR="$SCRIPT_DIR/images"
RUN_DIR="${EMULATOR_RUN_DIR:-$SCRIPT_DIR/run}"

VM_RAM="${EMULATOR_RAM:-4096}"
VM_CPUS="${EMULATOR_CPUS:-4}"
PORT_PREFIX="${PORT_PREFIX:-${NEXT_PUBLIC_STACK_PORT_PREFIX:-81}}"
READY_TIMEOUT="${EMULATOR_READY_TIMEOUT:-240}"

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

runtime_iso_path() {
  echo "$VM_DIR/runtime-config.iso"
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

prepare_runtime_config_iso() {
  local cfg_dir="$VM_DIR/runtime-config"
  local cfg_iso
  cfg_iso="$(runtime_iso_path)"
  rm -rf "$cfg_dir"
  mkdir -p "$cfg_dir"
  {
    printf "STACK_EMULATOR_PORT_PREFIX=%s\n" "$PORT_PREFIX"
  } > "$cfg_dir/runtime.env"
  cp "$SCRIPT_DIR/../base.env" "$cfg_dir/base.env"
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
  service_is_up "${PORT_PREFIX}28" tcp &&
    service_is_up "${PORT_PREFIX}05" http / &&
    service_is_up "${PORT_PREFIX}29" tcp &&
    service_is_up "${PORT_PREFIX}13" http /api/v1/health/ &&
    service_is_up "${PORT_PREFIX}36" http /ping &&
    service_is_up "${PORT_PREFIX}21" http /minio/health/live &&
    service_is_up "${PORT_PREFIX}25" http / 401
}

app_ready() {
  service_is_up "${PORT_PREFIX}02" http "/health?db=1" &&
    service_is_up "${PORT_PREFIX}01" http /handler/sign-in
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
  local base_img
  base_img="$(image_path)"

  if [ ! -f "$base_img" ]; then
    err "Missing QEMU image: $base_img"
    err "Run docker/local-emulator/qemu/build-image.sh $ARCH first."
    exit 1
  fi

  mkdir -p "$VM_DIR"
  local fingerprint_file="$VM_DIR/base-image.fingerprint"
  local current_fp
  current_fp="$(base_image_fingerprint "$base_img")"
  if [ -f "$VM_DIR/disk.qcow2" ]; then
    if [ -f "$fingerprint_file" ] && [ "$(cat "$fingerprint_file")" = "$current_fp" ]; then
      log "Reusing existing overlay disk (changes persist)"
    else
      warn "QEMU base image has changed — recreating overlay."
      rm -f "$VM_DIR/disk.qcow2" "$fingerprint_file"
    fi
  fi
  if [ ! -f "$VM_DIR/disk.qcow2" ]; then
    qemu-img create -f qcow2 -b "$base_img" -F qcow2 "$VM_DIR/disk.qcow2" >/dev/null
    base_image_fingerprint "$base_img" > "$fingerprint_file"
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
  # Deps services
  netdev+=",hostfwd=tcp::${PORT_PREFIX}28-:5432"
  netdev+=",hostfwd=tcp::${PORT_PREFIX}29-:2500"
  netdev+=",hostfwd=tcp::${PORT_PREFIX}05-:9001"
  netdev+=",hostfwd=tcp::${PORT_PREFIX}30-:1100"
  netdev+=",hostfwd=tcp::${PORT_PREFIX}13-:8071"
  netdev+=",hostfwd=tcp::${PORT_PREFIX}21-:9090"
  netdev+=",hostfwd=tcp::${PORT_PREFIX}25-:8080"
  netdev+=",hostfwd=tcp::${PORT_PREFIX}36-:8123"
  netdev+=",hostfwd=tcp::${PORT_PREFIX}37-:9009"
  # App services
  netdev+=",hostfwd=tcp::${PORT_PREFIX}01-:${PORT_PREFIX}01"
  netdev+=",hostfwd=tcp::${PORT_PREFIX}02-:${PORT_PREFIX}02"

  QEMU_CMD=(
    "$qemu_bin"
    -machine "$machine"
    -accel "$ACCEL"
    -cpu "$cpu"
    "${firmware_args[@]}"
    -boot order=c
    -m "$VM_RAM"
    -smp "$VM_CPUS"
    -drive "file=$VM_DIR/disk.qcow2,format=qcow2,if=virtio"
    -drive "file=$(runtime_iso_path),format=raw,if=virtio,readonly=on"
    -netdev "$netdev"
    -device virtio-net-pci,netdev=net0
    -device virtio-balloon-pci
    -virtfs "local,path=/,mount_tag=hostfs,security_model=none"
    -chardev "socket,id=monitor,path=$VM_DIR/monitor.sock,server=on,wait=off"
    -mon "chardev=monitor,mode=control"
    -serial "file:$VM_DIR/serial.log"
    -display none
    -daemonize
    -pidfile "$VM_DIR/qemu.pid"
  )

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
  local ports=("${PORT_PREFIX}01" "${PORT_PREFIX}02" "${PORT_PREFIX}05" "${PORT_PREFIX}13" "${PORT_PREFIX}21" "${PORT_PREFIX}25" "${PORT_PREFIX}28" "${PORT_PREFIX}29" "${PORT_PREFIX}30" "${PORT_PREFIX}36" "${PORT_PREFIX}37")
  local port
  for port in "${ports[@]}"; do
    if lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      err "Port $port is already in use. Stop the Docker emulator or other services first."
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
  info "Arch: $ARCH | Accel: $ACCEL | Prefix: $PORT_PREFIX"

  start_vm

  info "VM: ${VM_RAM}MB / ${VM_CPUS} CPUs"

  if ! wait_for_condition "deps services" "$READY_TIMEOUT" deps_ready; then
    tail_vm_logs
    exit 1
  fi

  if ! wait_for_condition "dashboard/backend" "$READY_TIMEOUT" app_ready; then
    tail_vm_logs
    exit 1
  fi

  log "All services are green. Overlay disk preserves changes across restarts."
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
  print_service_status "Dashboard" "${PORT_PREFIX}01" http /handler/sign-in
  print_service_status "Backend" "${PORT_PREFIX}02" http "/health?db=1"
  print_service_status "PostgreSQL" "${PORT_PREFIX}28" tcp
  print_service_status "Inbucket HTTP" "${PORT_PREFIX}05" http /
  print_service_status "Svix" "${PORT_PREFIX}13" http /api/v1/health/
  print_service_status "MinIO" "${PORT_PREFIX}21" http /minio/health/live
  print_service_status "QStash" "${PORT_PREFIX}25" http / 401
  print_service_status "ClickHouse" "${PORT_PREFIX}36" http /ping
  exit "$STATUS_FAILED"
}

cmd_bench() {
  local start_time end_time
  cmd_stop >/dev/null 2>&1 || true
  start_time="$(python3 - <<'PY'
import time
print(time.time())
PY
)"
  cmd_start
  end_time="$(python3 - <<'PY'
import time
print(time.time())
PY
)"
  python3 - <<PY
start_time = float("${start_time}")
end_time = float("${end_time}")
print(f"Startup time: {end_time - start_time:.1f}s")
PY
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
