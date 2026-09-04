#!/bin/sh
set -eu

runtime=/opt/hexclave-runtime
work_root=$runtime/work
archive=/opt/hexclave-node-archive.tar.gz
archive_checksum=/opt/hexclave-node-archive.sha256

expected_archive_sha256=$(awk 'NR == 1 { print $1 }' "$archive_checksum")
actual_archive_sha256=$(sha256sum "$archive" | awk '{ print $1 }')
if [ "$actual_archive_sha256" != "$expected_archive_sha256" ]; then
  echo "Node archive checksum mismatch" >&2
  exit 1
fi

ln -sf /lib/libc.so.6 /lib/libdl.so.2
dd if=/dev/zero of=/swapfile bs=1M count=256
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile

node_version=${NODE_VERSION:?NODE_VERSION must be set}
mkdir -p /opt/node
tar -xzf "$archive" -C /opt/node --strip-components=1 \
  "node-v${node_version}-linux-x64-glibc-217/bin" \
  "node-v${node_version}-linux-x64-glibc-217/lib"
ln -sf /opt/node/bin/node /usr/bin/node
mkdir -p /usr/local/bin "$work_root"

if [ -e /opt/node/bin/npm ]; then
  ln -sf /opt/node/bin/npm /usr/bin/npm
else
  cat > /usr/bin/npm <<'NPM_RUNNER'
#!/bin/sh
exec /usr/bin/node /opt/node/lib/node_modules/npm/bin/npm-cli.js "$@"
NPM_RUNNER
  chmod 755 /usr/bin/npm
fi

cat > /usr/local/bin/hexclave-run-job <<'JOB_RUNNER'
#!/bin/sh
set -eu

work_root=/opt/hexclave-runtime/work
job_directory=${1:-}
job_id=${job_directory#"$work_root/"}
case "$job_id" in
  '' | *[!0-9a-f-]* ) echo "Invalid job directory" >&2; exit 2 ;;
esac
case "$job_directory" in
  "$work_root/$job_id" ) ;;
  * ) echo "Invalid job directory" >&2; exit 2 ;;
esac

cd "$job_directory"
export HOME=/tmp/hexclave-home
mkdir -p "$HOME"
/usr/bin/npm install --ignore-scripts --no-audit --no-fund --package-lock=false
exec /usr/bin/node ./runner.mjs
JOB_RUNNER
chmod 700 /usr/local/bin/hexclave-run-job

rm -f "$archive" "$archive_checksum" /tmp/freestyle-snapshot-bootstrap.sh

/usr/bin/node --version
/usr/bin/npm --version

rm -rf /tmp/hexclave-home
mkdir -p /tmp/hexclave-home /opt/hexclave-npm-cache
ln -s /opt/hexclave-npm-cache /tmp/hexclave-home/.npm
