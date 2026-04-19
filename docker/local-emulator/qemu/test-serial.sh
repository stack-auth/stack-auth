#!/usr/bin/env bash
# Quick test: boot the base QEMU image with a minimal cloud-init that writes to
# serial via runcmd. Verifies that our logging approach works without running
# the full emulator build (~10s instead of ~10min).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/common.sh"

detect_host
ARCH="${1:-$HOST_ARCH}"

BASE_IMG="$SCRIPT_DIR/images/debian-13-base-${ARCH}.qcow2"
if [ ! -f "$BASE_IMG" ]; then
  echo "Base image not found: $BASE_IMG" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d /tmp/stack-serial-test-XXXXXX)"
trap 'kill "$(cat "$TMP_DIR/qemu.pid" 2>/dev/null)" 2>/dev/null; rm -rf "$TMP_DIR"' EXIT

# Create a temporary disk
cp "$BASE_IMG" "$TMP_DIR/disk.qcow2"

# Minimal cloud-init user-data that tests serial output from runcmd
cat > "$TMP_DIR/user-data" << 'EOF'
#cloud-config
write_files:
  - path: /usr/local/bin/provision-build
    permissions: '0755'
    content: |
      #!/bin/bash
      set -euo pipefail

      SERIAL=""
      for d in /dev/ttyAMA0 /dev/ttyS0; do
        [ -c "$d" ] && SERIAL="$d" && break
      done
      if [ -n "$SERIAL" ]; then
        exec > >(tee -a "$SERIAL") 2>&1
      fi

      echo "STACK_PROVISION: script started"
      sleep 1
      echo "STACK_PROVISION: step 2"
      for dev in /dev/console /dev/ttyAMA0 /dev/ttyS0; do
        echo "STACK_CLOUD_INIT_DONE" > "$dev" 2>/dev/null || true
      done
      shutdown -P now

runcmd:
  - [bash, /usr/local/bin/provision-build]
EOF

cat > "$TMP_DIR/meta-data" << 'EOF'
instance-id: serial-test
local-hostname: serial-test
EOF

# Build seed ISO
make_iso_from_dir "$TMP_DIR/seed.iso" "cidata" "$TMP_DIR"

: > "$TMP_DIR/serial.log"

case "$ARCH" in
  arm64)
    accel="hvf"
    firmware="$(find_aarch64_firmware)"
    qemu_base="qemu-system-aarch64 -machine virt -accel $accel -cpu max -bios $firmware"
    ;;
  amd64)
    qemu_base="qemu-system-x86_64 -machine q35 -accel hvf -cpu max"
    ;;
esac

$qemu_base \
  -boot order=c \
  -m 1024 \
  -smp 2 \
  -drive "file=$TMP_DIR/disk.qcow2,format=qcow2,if=virtio" \
  -drive "file=$TMP_DIR/seed.iso,format=raw,if=virtio,readonly=on" \
  -netdev user,id=net0 \
  -device virtio-net-pci,netdev=net0 \
  -serial "file:$TMP_DIR/serial.log" \
  -display none \
  -daemonize \
  -pidfile "$TMP_DIR/qemu.pid"

echo "QEMU started, waiting for serial output..."
echo "Serial log: $TMP_DIR/serial.log"

elapsed=0
timeout=120
while [ "$elapsed" -lt "$timeout" ]; do
  if grep -q "STACK_CLOUD_INIT_DONE" "$TMP_DIR/serial.log" 2>/dev/null; then
    echo ""
    echo "=== SUCCESS: STACK_CLOUD_INIT_DONE received ==="
    echo ""
    echo "=== All STACK_PROVISION lines ==="
    grep "STACK_PROVISION" "$TMP_DIR/serial.log" || echo "(none found)"
    exit 0
  fi

  # Show any STACK_PROVISION lines as they appear
  if grep -q "STACK_PROVISION" "$TMP_DIR/serial.log" 2>/dev/null; then
    grep "STACK_PROVISION" "$TMP_DIR/serial.log" | while IFS= read -r line; do
      echo "  [${elapsed}s] $line"
    done
  fi

  sleep 2
  elapsed=$((elapsed + 2))
  printf "\r  [%ds / %ds] waiting..." "$elapsed" "$timeout"
done

echo ""
echo "=== TIMEOUT: no STACK_CLOUD_INIT_DONE after ${timeout}s ==="
echo ""
echo "=== Last 30 lines of serial log ==="
tail -30 "$TMP_DIR/serial.log"
echo ""
echo "=== STACK_PROVISION lines ==="
grep "STACK_PROVISION" "$TMP_DIR/serial.log" || echo "(none found)"
exit 1
