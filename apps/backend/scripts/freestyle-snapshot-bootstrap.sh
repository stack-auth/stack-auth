#!/bin/sh
set -eu

runtime=/opt/hexclave-runtime
work_root=$runtime/work
bundle=/opt/hexclave-node-runtime.tar.gz
bundle_checksum=/opt/hexclave-node-runtime.sha256

expected_bundle_sha256=$(awk 'NR == 1 { print $1 }' "$bundle_checksum")
actual_bundle_sha256=$(sha256sum "$bundle" | awk '{ print $1 }')
if [ "$actual_bundle_sha256" != "$expected_bundle_sha256" ]; then
  echo "Node runtime bundle checksum mismatch" >&2
  exit 1
fi

tar -xzf "$bundle" -C /
mkdir -p /usr/local/bin "$work_root"

cat > /usr/bin/npm <<'NPM_RUNNER'
#!/bin/sh
exec /usr/bin/node /usr/lib/node_modules/npm/bin/npm-cli.js "$@"
NPM_RUNNER
chmod 755 /usr/bin/npm

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

rm -f "$bundle" "$bundle_checksum" /tmp/freestyle-snapshot-bootstrap.sh

/usr/bin/node --version
/usr/bin/npm --version
