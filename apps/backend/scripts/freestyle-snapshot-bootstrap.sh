#!/bin/sh
set -eu

runtime=/opt/hexclave-runtime
archive=/tmp/alpine-minirootfs.tar.gz
expected_archive_sha256=de9a11c0e0e7e9c94db3ed8af7b450eafc0b13687bd7e9199d55050f20aa0a89

actual_archive_sha256=$(sha256sum "$archive" | awk '{ print $1 }')
if [ "$actual_archive_sha256" != "$expected_archive_sha256" ]; then
  echo "Alpine minirootfs checksum mismatch" >&2
  exit 1
fi

mkdir -p "$runtime"
tar -xzf "$archive" -C "$runtime"
cp /etc/resolv.conf "$runtime/etc/resolv.conf"

mkdir -p /usr/local/bin "$runtime/dev" "$runtime/proc" "$runtime/work" "$runtime/usr/local/bin"
mknod -m 666 "$runtime/dev/null" c 1 3
mknod -m 666 "$runtime/dev/zero" c 1 5
mknod -m 444 "$runtime/dev/random" c 1 8
mknod -m 444 "$runtime/dev/urandom" c 1 9

mount -t proc proc "$runtime/proc"
chroot "$runtime" /sbin/apk add --no-cache nodejs npm ca-certificates
chroot "$runtime" /usr/bin/node --version
chroot "$runtime" /usr/bin/npm --version
umount "$runtime/proc"

cat > "$runtime/usr/local/bin/hexclave-run-job" <<'INNER_RUNNER'
#!/bin/sh
set -eu

job_directory=${1:-}
job_id=${job_directory#/work/}
case "$job_id" in
  '' | *[!0-9a-f-]* ) echo "Invalid job directory" >&2; exit 2 ;;
esac
case "$job_directory" in
  "/work/$job_id" ) ;;
  * ) echo "Invalid job directory" >&2; exit 2 ;;
esac

cd "$job_directory"
export HOME=/tmp/hexclave-home
mkdir -p "$HOME"
npm install --ignore-scripts --no-audit --no-fund --package-lock=false
exec node ./runner.mjs
INNER_RUNNER
chmod 700 "$runtime/usr/local/bin/hexclave-run-job"

cat > /usr/local/bin/hexclave-run-job <<'OUTER_RUNNER'
#!/bin/sh
set -eu

runtime=/opt/hexclave-runtime
job_directory=${1:-}
job_id=${job_directory#/work/}
case "$job_id" in
  '' | *[!0-9a-f-]* ) echo "Invalid job directory" >&2; exit 2 ;;
esac
case "$job_directory" in
  "/work/$job_id" ) ;;
  * ) echo "Invalid job directory" >&2; exit 2 ;;
esac

cp /etc/resolv.conf "$runtime/etc/resolv.conf"
if ! mountpoint -q "$runtime/proc"; then
  mount -t proc proc "$runtime/proc"
fi
exec chroot "$runtime" /usr/local/bin/hexclave-run-job "$job_directory"
OUTER_RUNNER
chmod 700 /usr/local/bin/hexclave-run-job

rm -f "$archive" /tmp/freestyle-snapshot-bootstrap.sh
