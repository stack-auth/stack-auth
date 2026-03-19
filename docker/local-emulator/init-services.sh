#!/bin/bash
set -e

INIT_SERVICES_DONE_FILE=/var/run/stack-local-init-services.done
INIT_SERVICES_FAILED_FILE=/var/run/stack-local-init-services.failed

rm -f "$INIT_SERVICES_DONE_FILE" "$INIT_SERVICES_FAILED_FILE"
trap 'touch "$INIT_SERVICES_FAILED_FILE"' ERR

wait_for_http() {
  local url="$1" attempts=0
  while [ "$attempts" -lt 60 ]; do
    if curl -sf "$url" > /dev/null 2>&1; then return 0; fi
    sleep 1
    attempts=$((attempts + 1))
  done
  echo "Timed out waiting for $url" >&2
  exit 1
}

wait_for_http http://127.0.0.1:9090/minio/health/live
mc alias set local http://127.0.0.1:9090 s3mockroot s3mockroot --api S3v4
mc mb --ignore-existing local/stack-storage
mc mb --ignore-existing local/stack-storage-private

wait_for_http http://127.0.0.1:8123/ping
curl -s "http://127.0.0.1:8123/?user=default" --data "CREATE DATABASE IF NOT EXISTS analytics"

rm -f "$INIT_SERVICES_FAILED_FILE"
touch "$INIT_SERVICES_DONE_FILE"
