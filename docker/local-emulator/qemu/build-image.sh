#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"

IMAGE_DIR="${EMULATOR_IMAGE_DIR:-$HOME/.stack/emulator/images}"
CLOUD_INIT_ROOT="$SCRIPT_DIR/cloud-init"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

DEBIAN_VERSION="${DEBIAN_VERSION:-13}"
DISK_SIZE="${EMULATOR_DISK_SIZE:-12G}"
RAM="${EMULATOR_BUILD_RAM:-4096}"
CPUS="${EMULATOR_BUILD_CPUS:-$(sysctl -n hw.ncpu 2>/dev/null || nproc 2>/dev/null || echo 4)}"
PROVISION_TIMEOUT="${EMULATOR_PROVISION_TIMEOUT:-3200}"
EMULATOR_IMAGE_NAME="${EMULATOR_IMAGE_NAME:-stack-local-emulator}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[build]${NC} $*"; }
warn() { echo -e "${YELLOW}[build]${NC} $*"; }
err()  { echo -e "${RED}[build]${NC} $*" >&2; }

detect_host
TARGET_ARCH="${1:-$HOST_ARCH}"

TARGET_ARCHS=()
case "$TARGET_ARCH" in
  arm64) TARGET_ARCHS=(arm64) ;;
  amd64) TARGET_ARCHS=(amd64) ;;
  both) TARGET_ARCHS=(arm64 amd64) ;;
  *) err "Usage: $0 [arm64|amd64|both]"; exit 1 ;;
esac

DOCKER_IMAGES=("$EMULATOR_IMAGE_NAME")

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

docker_platform_for_arch() {
  case "$1" in
    arm64) echo "linux/arm64" ;;
    amd64) echo "linux/amd64" ;;
    *) err "Unsupported target arch: $1"; exit 1 ;;
  esac
}

build_local_emulator_image() {
  local arch="$1"
  local platform
  platform="$(docker_platform_for_arch "$arch")"

  log "Building Docker emulator image (${arch})..."
  docker buildx build \
    --platform "$platform" \
    --tag "$EMULATOR_IMAGE_NAME" \
    --load \
    -f "$REPO_ROOT/docker/local-emulator/Dockerfile" \
    "$REPO_ROOT"
}

qemu_cmd_prefix_for_arch() {
  local arch="$1"
  case "$arch" in
    arm64)
      local accel="tcg"
      local cpu="max"
      if [ "$HOST_ARCH" = "arm64" ]; then
        # Same-arch: prefer hardware acceleration, keep -cpu max. If no
        # accelerator is available (e.g. Azure arm64 runners with no
        # nested virt) we fall through to TCG, but same-arch TCG handles
        # -cpu max correctly and more named CPU models have TCG bugs
        # than -cpu max does.
        case "$HOST_OS" in
          darwin) accel="hvf" ;;
          linux) [ -w /dev/kvm ] && accel="kvm" ;;
        esac
      else
        # Cross-arch TCG (amd64 host emulating arm64 guest) needs a CPU
        # model that threads a narrow needle:
        #   * -cpu max advertises armv8.5+ features (PAC, BTI, SVE, LSE…)
        #     that V8's TurboFan then emits JIT code for; cross-arch TCG
        #     mistranslates some of those and node SIGTRAPs in migrations.
        #   * -cpu cortex-a72 (armv8.0-a) keeps V8 safe but makes
        #     ClickHouse SIGILL on startup because its statically-linked
        #     LSE atomics (armv8.1+) aren't recognized.
        # cortex-a76 is armv8.2-a: it exposes LSE (ClickHouse happy)
        # while predating PAC (v8.3) and BTI (v8.5), so V8's aggressive
        # JIT tiers don't emit the instructions that tripped TCG. Pair
        # this with `node --no-opt` on the migration exec, which keeps
        # V8 in Ignition+Sparkplug only (no TurboFan/Maglev).
        cpu="cortex-a76"
      fi
      local firmware
      firmware="$(find_aarch64_firmware)"
      echo "qemu-system-aarch64 -machine virt -accel $accel -cpu $cpu -bios $firmware"
      ;;
    amd64)
      local accel="tcg"
      local cpu="max"
      if [ "$HOST_ARCH" = "amd64" ]; then
        case "$HOST_OS" in
          darwin) accel="hvf" ;;
          linux) [ -w /dev/kvm ] && accel="kvm" ;;
        esac
      else
        cpu="qemu64"
      fi
      echo "qemu-system-x86_64 -machine q35 -accel $accel -cpu $cpu"
      ;;
  esac
}

final_image_name() {
  echo "$IMAGE_DIR/stack-emulator-$1.qcow2"
}

prepare_bundle_artifacts() {
  local arch="$1"
  local bundle_tgz="$IMAGE_DIR/emulator-${arch}-docker-images.tar.gz"
  local bundle_meta="$bundle_tgz.image-ids"

  local current_ids=""
  for img in "${DOCKER_IMAGES[@]}"; do
    current_ids+="$(docker image inspect --format '{{.ID}}' "$img")"$'\n'
  done

  local cached_ids=""
  if [ -f "$bundle_meta" ]; then
    cached_ids="$(cat "$bundle_meta")"
  fi

  if [ -f "$bundle_tgz" ] && [ "$cached_ids" = "$current_ids" ]; then
    log "Reusing bundle: $bundle_tgz"
    return 0
  fi

  log "Creating Docker image bundle (${arch})..."
  for img in "${DOCKER_IMAGES[@]}"; do
    if ! docker image inspect "$img" >/dev/null 2>&1; then
      err "Missing Docker image: $img. Build the local emulator images first, then rerun the QEMU image build."
      exit 1
    fi
  done
  local tmp_bundle="${bundle_tgz}.tmp"
  rm -f "$tmp_bundle"
  docker save "${DOCKER_IMAGES[@]}" | gzip -c > "$tmp_bundle"
  mv "$tmp_bundle" "$bundle_tgz"
  printf "%s" "$current_ids" > "$bundle_meta"
}

contains_provision_marker() {
  local provision_log="$1"
  local serial_log="$2"
  local marker="$3"

  if [ -f "$provision_log" ] && grep -Fqx "$marker" "$provision_log" 2>/dev/null; then
    return 0
  fi

  if [ -f "$serial_log" ] && LC_ALL=C strings -a "$serial_log" 2>/dev/null | grep -Fqx "$marker" 2>/dev/null; then
    return 0
  fi

  return 1
}

line_count() {
  local file="$1"
  local count=0
  if [ -f "$file" ]; then
    count="$(wc -l < "$file" | tr -d '[:space:]')" || count=0
  fi
  printf '%s\n' "$count"
}

persist_provision_logs() {
  local arch="$1"
  local serial_log="$2"
  local provision_log="$3"

  cp "$serial_log" "$IMAGE_DIR/provision-emulator-${arch}.log" 2>/dev/null || true
  cp "$provision_log" "$IMAGE_DIR/provision-emulator-${arch}.progress.log" 2>/dev/null || true
}

build_one() {
  local arch="$1"
  local base_img="$IMAGE_DIR/debian-${DEBIAN_VERSION}-base-${arch}.qcow2"
  local bundle_tgz="$IMAGE_DIR/emulator-${arch}-docker-images.tar.gz"
  local final_img
  final_img="$(final_image_name "$arch")"

  log "━━━ Building emulator image (${arch}) ━━━"

  local tmp_dir
  tmp_dir="$(mktemp -d /tmp/stack-qemu-build-${arch}-XXXXXX)"
  local tmp_img="$tmp_dir/disk.qcow2"
  local seed_iso="$tmp_dir/seed.iso"
  local bundle_iso="$tmp_dir/bundle.iso"
  local bundle_dir="$tmp_dir/bundle"
  local serial_log="$tmp_dir/serial.log"
  local provision_log="$tmp_dir/provision.log"
  local pidfile="$tmp_dir/qemu.pid"
  local qemu_base pid elapsed total_build_lines
  local last_build_lines=0
  local guest_exited=false
  local guest_failed=false
  local start_time=$SECONDS

  cp "$base_img" "$tmp_img"
  qemu-img resize "$tmp_img" "$DISK_SIZE" >/dev/null 2>&1 || true

  local seed_dir
  seed_dir="$(mktemp -d)"
  mkdir -p "$seed_dir"
  cp "$CLOUD_INIT_ROOT/emulator/meta-data" "$seed_dir/meta-data"
  cp "$CLOUD_INIT_ROOT/emulator/user-data" "$seed_dir/user-data"
  make_iso_from_dir "$seed_iso" "cidata" "$seed_dir"
  rm -rf "$seed_dir"

  mkdir -p "$bundle_dir"
  cp "$bundle_tgz" "$bundle_dir/img.tgz"
  cp "$BUILD_ENV_FILE" "$bundle_dir/build.env"
  # Tell the guest which arch it's being built for so cross-arch (TCG) builds
  # can skip the smoke test, which isn't reliable under software emulation.
  printf 'STACK_EMULATOR_BUILD_ARCH=%s\n' "$arch" > "$bundle_dir/build-arch.env"
  make_iso_from_dir "$bundle_iso" "STACKBUNDLE" "$bundle_dir"

  : > "$serial_log"
  : > "$provision_log"
  qemu_base="$(qemu_cmd_prefix_for_arch "$arch")"
  log "QEMU command prefix (${arch}): $qemu_base"

  # shellcheck disable=SC2086
  $qemu_base \
    -boot order=c \
    -m "$RAM" \
    -smp "$CPUS" \
    -drive "file=$tmp_img,format=qcow2,if=virtio,discard=on,detect-zeroes=unmap" \
    -drive "file=$seed_iso,format=raw,if=virtio,readonly=on" \
    -drive "file=$bundle_iso,format=raw,if=virtio,readonly=on" \
    -netdev user,id=net0 \
    -device virtio-net-pci,netdev=net0 \
    -virtfs "local,path=$tmp_dir,mount_tag=hostfs,security_model=none" \
    -serial "file:$serial_log" \
    -display none \
    -daemonize \
    -pidfile "$pidfile"

  pid="$(cat "$pidfile")"
  elapsed=0
  while [ "$elapsed" -lt "$PROVISION_TIMEOUT" ]; do
    if contains_provision_marker "$provision_log" "$serial_log" "STACK_CLOUD_INIT_DONE"; then
      break
    fi

    if contains_provision_marker "$provision_log" "$serial_log" "STACK_CLOUD_INIT_FAILED"; then
      guest_failed=true
      break
    fi

    if [ -f "$provision_log" ]; then
      total_build_lines="$(line_count "$provision_log")"
      if [ "$total_build_lines" -gt "$last_build_lines" ]; then
        echo ""
        sed -n "$((last_build_lines + 1)),${total_build_lines}p" "$provision_log" 2>/dev/null | while IFS= read -r msg; do
          if [ "$msg" = "STACK_CLOUD_INIT_DONE" ]; then
            continue
          fi
          printf "  [%3ds] %s\n" "$elapsed" "$msg"
        done
        last_build_lines="$total_build_lines"
      fi
    fi

    if ! kill -0 "$pid" 2>/dev/null; then
      guest_exited=true
      break
    fi

    sleep 5
    elapsed=$((SECONDS - start_time))
    printf "\r  [%3ds / %ds] provisioning emulator..." "$elapsed" "$PROVISION_TIMEOUT"
  done
  echo ""

  if ! contains_provision_marker "$provision_log" "$serial_log" "STACK_CLOUD_INIT_DONE"; then
    if [ "$guest_failed" = true ]; then
      err "Guest provisioning reported failure for emulator (${arch})"
    elif [ "$guest_exited" = true ]; then
      err "Provisioning exited before completion for emulator (${arch})"
    else
      err "Provisioning timed out for emulator (${arch})"
    fi

    if [ -s "$provision_log" ]; then
      tail -50 "$provision_log" >&2 || true
    else
      LC_ALL=C strings -a "$serial_log" 2>/dev/null | tail -50 >&2 || tail -50 "$serial_log" >&2 || true
    fi

    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      sleep 1
      kill -9 "$pid" 2>/dev/null || true
    fi

    persist_provision_logs "$arch" "$serial_log" "$provision_log"
    rm -rf "$tmp_dir"
    exit 1
  fi

  local shutdown_wait=0
  while [ "$shutdown_wait" -lt 90 ] && kill -0 "$pid" 2>/dev/null; do
    sleep 1
    shutdown_wait=$((shutdown_wait + 1))
  done

  if kill -0 "$pid" 2>/dev/null; then
    warn "Guest did not power off cleanly; forcing shutdown."
    kill "$pid" 2>/dev/null || true
    sleep 2
    kill -9 "$pid" 2>/dev/null || true
  fi

  persist_provision_logs "$arch" "$serial_log" "$provision_log"

  log "Compressing final image (this may take several minutes)..."
  qemu-img convert -p -O qcow2 -c "$tmp_img" "$final_img"
  rm -rf "$tmp_dir"

  local size
  size="$(du -h "$final_img" | cut -f1)"
  log "━━━ Emulator image ready: $final_img (${size}) ━━━"
}

log "Generating emulator build env file..."
node "$REPO_ROOT/docker/local-emulator/generate-env-development.mjs"
BUILD_ENV_FILE="$REPO_ROOT/docker/local-emulator/.env.development"

for arch in "${TARGET_ARCHS[@]}"; do
  local_base="$IMAGE_DIR/debian-${DEBIAN_VERSION}-base-${arch}.qcow2"
  download_cloud_image "$arch" "$local_base"
  build_local_emulator_image "$arch"
  prepare_bundle_artifacts "$arch"
  build_one "$arch"
done

log "Done. Start with: docker/local-emulator/qemu/run-emulator.sh start"
