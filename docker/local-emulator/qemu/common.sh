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
