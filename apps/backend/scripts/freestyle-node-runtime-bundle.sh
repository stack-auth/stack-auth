#!/bin/sh
set -eu

archive=/tmp/hexclave-node-archive.tar.gz
source_root=/opt/hexclave-node-source
bundle_root=/opt/hexclave-node-runtime
bundle=/tmp/hexclave-node-runtime.tar.gz
bundle_checksum=/tmp/hexclave-node-runtime.sha256

rm -rf "$source_root" "$bundle_root"
mkdir -p "$source_root" "$bundle_root/usr/bin" "$bundle_root/usr/lib/node_modules" "$bundle_root/etc/ssl/certs" "$bundle_root/tmp"
tar -xzf "$archive" -C "$source_root" --strip-components=1

copy_runtime_file() {
  source_path=$1
  case "$source_path" in
    /* ) ;;
    * ) echo "Refusing to copy a non-absolute runtime path" >&2; exit 1 ;;
  esac
  if [ ! -e "$source_path" ] && [ ! -L "$source_path" ]; then
    echo "Missing Node runtime file: $source_path" >&2
    exit 1
  fi
  mkdir -p "$bundle_root$(dirname "$source_path")"
  cp -L "$source_path" "$bundle_root$source_path"
}

cp "$source_root/bin/node" "$bundle_root/usr/bin/node"

ldd "$source_root/bin/node" \
  | awk '$2 == "=>" && $3 ~ /^\// { print $3 } $1 ~ /^\// { print $1 }' \
  | while IFS= read -r library_path; do
      copy_runtime_file "$library_path"
    done

for nss_library in \
  /lib/x86_64-linux-gnu/libnss_dns.so.2 \
  /lib/x86_64-linux-gnu/libnss_files.so.2; do
  if [ -e "$nss_library" ]; then
    copy_runtime_file "$nss_library"
  fi
done

cp -a "$source_root/lib/node_modules/npm" "$bundle_root/usr/lib/node_modules/npm"
cp /etc/ssl/certs/ca-certificates.crt "$bundle_root/etc/ssl/certs/ca-certificates.crt"
cp /etc/ssl/certs/ca-certificates.crt "$bundle_root/etc/ssl/cert.pem"
if [ -f /etc/nsswitch.conf ]; then
  cp /etc/nsswitch.conf "$bundle_root/etc/nsswitch.conf"
fi
if [ -f /etc/ssl/openssl.cnf ]; then
  cp /etc/ssl/openssl.cnf "$bundle_root/etc/ssl/openssl.cnf"
fi

chroot "$bundle_root" /usr/bin/node --version
HOME=/tmp chroot "$bundle_root" /usr/bin/node /usr/lib/node_modules/npm/bin/npm-cli.js --version

tar -czf "$bundle" -C "$bundle_root" .
sha256sum "$bundle" | awk '{ print $1 }' > "$bundle_checksum"
