#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"

IMAGE_DIR="$SCRIPT_DIR/images"
CLOUD_INIT_ROOT="$SCRIPT_DIR/cloud-init"
PREPARE_IMAGE_BUNDLE_SCRIPT="$SCRIPT_DIR/prepare-image-bundle.sh"

DEBIAN_VERSION="${DEBIAN_VERSION:-13}"
DISK_SIZE="${EMULATOR_DISK_SIZE:-16G}"
RAM="${EMULATOR_BUILD_RAM:-4096}"
CPUS="${EMULATOR_BUILD_CPUS:-4}"
PROVISION_TIMEOUT="${EMULATOR_PROVISION_TIMEOUT:-1800}"
PARALLEL_BUILDS="${EMULATOR_BUILD_PARALLEL:-2}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[build]${NC} $*"; }
warn() { echo -e "${YELLOW}[build]${NC} $*"; }
err()  { echo -e "${RED}[build]${NC} $*" >&2; }

detect_host
TARGET_ARCH="${1:-$HOST_ARCH}"
TARGET_ROLE="${2:-all}"

TARGET_ARCHS=()
case "$TARGET_ARCH" in
  arm64) TARGET_ARCHS=(arm64) ;;
  amd64) TARGET_ARCHS=(amd64) ;;
  both) TARGET_ARCHS=(arm64 amd64) ;;
  *) err "Usage: $0 [arm64|amd64|both] [all|deps|dev-server]"; exit 1 ;;
esac

TARGET_ROLES=()
case "$TARGET_ROLE" in
  all) TARGET_ROLES=(deps dev-server) ;;
  deps) TARGET_ROLES=(deps) ;;
  dev-server) TARGET_ROLES=(dev-server) ;;
  *) err "Usage: $0 [arm64|amd64|both] [all|deps|dev-server]"; exit 1 ;;
esac

check_deps() {
  local missing=()
  local arch qemu_bin

  for arch in "${TARGET_ARCHS[@]}"; do
    qemu_bin="$(qemu_binary_for_arch "$arch")"
    command -v "$qemu_bin" >/dev/null 2>&1 || missing+=("$qemu_bin")
  done

  for cmd in qemu-img curl docker gzip; do
    command -v "$cmd" >/dev/null 2>&1 || missing+=("$cmd")
  done

  if ! command -v mkisofs >/dev/null 2>&1 && ! command -v genisoimage >/dev/null 2>&1 && ! command -v hdiutil >/dev/null 2>&1; then
    missing+=("mkisofs/genisoimage/hdiutil")
  fi

  if [ "${#missing[@]}" -gt 0 ]; then
    err "Missing build dependencies: ${missing[*]}"
    exit 1
  fi
}

check_deps
mkdir -p "$IMAGE_DIR"

download_cloud_image() {
  local arch="$1"
  local dest="$2"
  local deb_arch

  case "$arch" in
    arm64) deb_arch="arm64" ;;
    amd64) deb_arch="amd64" ;;
    *) err "Unsupported target arch: $arch"; exit 1 ;;
  esac

  local url="https://cloud.debian.org/images/cloud/trixie/daily/latest/debian-${DEBIAN_VERSION}-generic-${deb_arch}-daily.qcow2"
  if [ -f "$dest" ]; then
    log "Base image already cached: $dest"
    return 0
  fi

  log "Downloading Debian ${DEBIAN_VERSION} cloud image for ${arch}..."
  curl -fSL --progress-bar -o "$dest" "$url"
}

qemu_cmd_prefix_for_arch() {
  local arch="$1"
  case "$arch" in
    arm64)
      local accel="tcg"
      if [ "$HOST_ARCH" = "arm64" ]; then
        case "$HOST_OS" in
          darwin) accel="hvf" ;;
          linux) [ -e /dev/kvm ] && accel="kvm" ;;
        esac
      fi
      local firmware
      firmware="$(find_aarch64_firmware)"
      echo "qemu-system-aarch64 -machine virt -accel $accel -cpu max -bios $firmware"
      ;;
    amd64)
      local accel="tcg"
      local cpu="max"
      if [ "$HOST_ARCH" = "amd64" ]; then
        case "$HOST_OS" in
          darwin) accel="hvf" ;;
          linux) [ -e /dev/kvm ] && accel="kvm" ;;
        esac
      else
        cpu="qemu64"
      fi
      echo "qemu-system-x86_64 -machine q35 -accel $accel -cpu $cpu"
      ;;
  esac
}

image_name_for_role() {
  case "$1" in
    deps) echo "stack-local-emulator-deps" ;;
    dev-server) echo "stack-local-emulator-app" ;;
    *) return 1 ;;
  esac
}

prepare_cloud_init_dir() {
  local role="$1"
  local out_dir="$2"
  mkdir -p "$out_dir"
  cp "$CLOUD_INIT_ROOT/$role/meta-data" "$out_dir/meta-data"
  cp "$CLOUD_INIT_ROOT/$role/user-data" "$out_dir/user-data"
}

make_seed_iso() {
  local iso_path="$1"
  local role="$2"
  local seed_dir
  seed_dir="$(mktemp -d)"
  prepare_cloud_init_dir "$role" "$seed_dir"
  make_iso_from_dir "$iso_path" "cidata" "$seed_dir"
  rm -rf "$seed_dir"
}

prepare_role_bundle() {
  local role="$1"
  local out_path="$2"
  local image_name
  image_name="$(image_name_for_role "$role")"
  "$PREPARE_IMAGE_BUNDLE_SCRIPT" "$out_path" "$image_name"
}

final_image_name() {
  echo "$IMAGE_DIR/stack-emulator-$1-$2.qcow2"
}

prepare_bundle_artifacts() {
  local arch="$1"
  local role="$2"
  local bundle_tgz="$IMAGE_DIR/${role}-${arch}-docker-image.tar.gz"
  local bundle_meta="$bundle_tgz.image-id"
  local image_name image_id cached_image_id
  image_name="$(image_name_for_role "$role")"
  image_id="$(docker image inspect --format '{{.ID}}' "$image_name")"
  cached_image_id=""
  if [ -f "$bundle_meta" ]; then
    cached_image_id="$(cat "$bundle_meta")"
  fi

  if [ -f "$bundle_tgz" ] && [ "$cached_image_id" = "$image_id" ]; then
    log "Reusing bundle: $bundle_tgz"
    return 0
  fi

  log "Creating Docker image bundle for ${role} (${arch})..."
  prepare_role_bundle "$role" "$bundle_tgz"
  printf "%s" "$image_id" > "$bundle_meta"
}

build_one() {
  local role="$1"
  local arch="$2"
  local base_img="$IMAGE_DIR/debian-${DEBIAN_VERSION}-base-${arch}.qcow2"
  local final_img
  final_img="$(final_image_name "$role" "$arch")"
  local bundle_tgz="$IMAGE_DIR/${role}-${arch}-docker-image.tar.gz"

  log "━━━ Building ${role} image (${arch}) ━━━"

  local tmp_dir
  tmp_dir="$(mktemp -d /tmp/stack-qemu-build-${role}-${arch}-XXXXXX)"
  local tmp_img="$tmp_dir/disk.qcow2"
  local seed_iso="$tmp_dir/seed.iso"
  local bundle_iso="$tmp_dir/bundle.iso"
  local bundle_dir="$tmp_dir/bundle"
  local serial_log="$tmp_dir/serial.log"
  local pidfile="$tmp_dir/qemu.pid"
  local qemu_base pid elapsed
  local start_time=$SECONDS

  cp "$base_img" "$tmp_img"
  qemu-img resize "$tmp_img" "$DISK_SIZE" >/dev/null 2>&1 || true

  make_seed_iso "$seed_iso" "$role"

  mkdir -p "$bundle_dir"
  cp "$bundle_tgz" "$bundle_dir/img.tgz"
  make_iso_from_dir "$bundle_iso" "STACKBUNDLE" "$bundle_dir"

  : > "$serial_log"
  qemu_base="$(qemu_cmd_prefix_for_arch "$arch")"

  # shellcheck disable=SC2086
  $qemu_base \
    -boot order=c \
    -m "$RAM" \
    -smp "$CPUS" \
    -drive "file=$tmp_img,format=qcow2,if=virtio" \
    -drive "file=$seed_iso,format=raw,if=virtio,readonly=on" \
    -drive "file=$bundle_iso,format=raw,if=virtio,readonly=on" \
    -netdev user,id=net0 \
    -device virtio-net-pci,netdev=net0 \
    -serial "file:$serial_log" \
    -display none \
    -daemonize \
    -pidfile "$pidfile"

  pid="$(cat "$pidfile")"
  elapsed=0
  while [ "$elapsed" -lt "$PROVISION_TIMEOUT" ]; do
    if grep -q "STACK_CLOUD_INIT_DONE" "$serial_log" 2>/dev/null; then
      break
    fi
    sleep 5
    elapsed=$((SECONDS - start_time))
    printf "\r  [%3ds / %ds] provisioning %s..." "$elapsed" "$PROVISION_TIMEOUT" "$role"
  done
  echo ""

  if ! grep -q "STACK_CLOUD_INIT_DONE" "$serial_log" 2>/dev/null; then
    err "Provisioning timed out for ${role} (${arch})"
    tail -50 "$serial_log" >&2 || true
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      sleep 1
      kill -9 "$pid" 2>/dev/null || true
    fi
    rm -rf "$tmp_dir"
    exit 1
  fi

  local shutdown_wait=0
  while [ "$shutdown_wait" -lt 90 ] && kill -0 "$pid" 2>/dev/null; do
    sleep 1
    shutdown_wait=$((shutdown_wait + 1))
  done

  if kill -0 "$pid" 2>/dev/null; then
    warn "Guest did not power off cleanly for ${role}; forcing shutdown."
    kill "$pid" 2>/dev/null || true
    sleep 2
    kill -9 "$pid" 2>/dev/null || true
  fi

  cp "$tmp_img" "$final_img"
  cp "$serial_log" "$IMAGE_DIR/provision-${role}-${arch}.log"
  rm -rf "$tmp_dir"

  qemu-img convert -O qcow2 -c "$final_img" "$final_img.tmp"
  mv "$final_img.tmp" "$final_img"

  local size
  size="$(du -h "$final_img" | cut -f1)"
  log "━━━ ${role} image ready: $final_img (${size}) ━━━"
}

build_all_for_arch() {
  local arch="$1"
  local base_img="$IMAGE_DIR/debian-${DEBIAN_VERSION}-base-${arch}.qcow2"
  download_cloud_image "$arch" "$base_img"

  local pids=()
  local role
  for role in "${TARGET_ROLES[@]}"; do
    prepare_bundle_artifacts "$arch" "$role" &
    pids+=("$!")
  done
  for pid in "${pids[@]}"; do
    wait "$pid"
  done

  pids=()
  for role in "${TARGET_ROLES[@]}"; do
    if [ "${#TARGET_ROLES[@]}" -gt 1 ] && [ "$PARALLEL_BUILDS" -gt 1 ]; then
      build_one "$role" "$arch" &
      pids+=("$!")
    else
      build_one "$role" "$arch"
    fi
  done
  if [ "${#pids[@]}" -gt 0 ]; then
    for pid in "${pids[@]}"; do
      wait "$pid"
    done
  fi
}

for arch in "${TARGET_ARCHS[@]}"; do
  build_all_for_arch "$arch"
done

log "Done. Start with: docker/local-emulator/qemu/run-emulator.sh start"
