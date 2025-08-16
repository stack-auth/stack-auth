# syntax=docker/dockerfile:1.6
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive \
    RAM=1024 \
    VCPUS=2

# Basic first install just so we can download the VM image
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates

# --- VM assets (build-time) ---
WORKDIR /vm
# Ubuntu 24.04 (Noble) cloud image (qcow2 + cloud-init ready)
RUN curl -fsSL -O https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img

# QEMU + cloud-init tooling + Node + SSH/network tools
RUN apt-get update && apt-get install -y --no-install-recommends \
      qemu-system-x86 qemu-utils cloud-image-utils \
      tini nodejs npm procps \
      openssh-client netcat-openbsd socat jq \
    && rm -rf /var/lib/apt/lists/*

# Generate an SSH keypair inside the image at build time
RUN ssh-keygen -t rsa -b 4096 -N "" -f /vm/id_rsa

# Minimal cloud-init: install Podman inside the VM
RUN printf '%s\n' \
  '#cloud-config' \
  'ssh_deletekeys: false' \
  'users:' \
  '  - name: root' \
  '    ssh-authorized-keys:' \
  "      - $(cat /vm/id_rsa.pub)" \
  'package_update: true' \
  'packages:' \
  '  - podman' \
  '  - crun' \
  '  - fuse-overlayfs' \
  '  - uidmap' \
  '  - iptables' \
  '  - iproute2' \
  > /vm/user-data \
  && printf '' > /vm/meta-data \
  && cloud-localds /vm/seed.img /vm/user-data /vm/meta-data

# --- runtime launcher & node server ---
WORKDIR /app

ENV QEMU_CMD="qemu-system-x86_64 \
  -machine accel=tcg \
  -m "${RAM}" -smp "${VCPUS}" \
  -drive if=virtio,file=/vm/noble-server-cloudimg-amd64.img,format=qcow2 \
  -drive if=virtio,file=/vm/seed.img,format=raw \
  -netdev user,id=net0,hostfwd=tcp::${SSH_PORT}-:22 \
  -device virtio-net-pci,netdev=net0 \
  -serial file:/tmp/qemu-serial.log \
  -display none \
  -daemonize \
  -pidfile /tmp/qemu.pid"

# Pre-build the VM
RUN $QEMU_CMD -qmp unix:/tmp/qmp-sock,server,nowait \
    && tail -n +1 -f /tmp/qemu-serial.log & \
    while ! grep -q 'Finished .* Cloud-init: Final Stage' /tmp/qemu-serial.log; do sleep 1; done \
    && sleep 5 \
    && printf '{"execute":"stop"}\n' | socat - UNIX-CONNECT:/tmp/qmp-sock | jq -e '.return != null' \
    && printf '{"execute":"savevm","arguments":{"name":"post-init"}}\n' | socat - UNIX-CONNECT:/tmp/qmp-sock | jq -e '.return != null' \
    && printf '{"execute":"quit"}\n' | socat - UNIX-CONNECT:/tmp/qmp-sock | jq -e '.return != null' \
    && sleep 20

# Install Node.js 20
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*


# Copy package files and install dependencies
COPY package.json ./
COPY tsconfig.json ./
RUN npm install --verbose

# Copy source code
COPY src ./src

# Build the application
RUN npm run build

RUN cat > /usr/local/bin/start.sh <<'EOF' && chmod +x /usr/local/bin/start.sh
#!/usr/bin/env bash
set -euo pipefail
: "${RAM:=1024}"
: "${VCPUS:=2}"
: "${SSH_PORT:=10022}"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting Ubuntu VM with QEMU..."

# Boot the VM with SSH port forwarding and serial console
$QEMU_CMD -loadvm post-init

# Check if QEMU started successfully
if [ -f /tmp/qemu.pid ]; then
    PID=$(cat /tmp/qemu.pid)
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] QEMU VM started with PID: $PID"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] SSH will be available on port ${SSH_PORT} once VM boots"
else
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: Failed to start QEMU VM"
    exit 1
fi

# Monitor VM boot progress in background
(
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Monitoring VM boot progress..."
    for i in {1..120}; do
        # Check if SSH port is open
        if timeout 1 bash -c "echo > /dev/tcp/localhost/${SSH_PORT}" 2>/dev/null; then
            echo "[$(date '+%Y-%m-%d %H:%M:%S')] VM SSH port is now open on port ${SSH_PORT}"
            break
        fi
        
        # Show serial console progress every 10 seconds
        if [ $((i % 10)) -eq 0 ] && [ -f /tmp/qemu-serial.log ]; then
            LINES=$(wc -l < /tmp/qemu-serial.log 2>/dev/null || echo 0)
            echo "[$(date '+%Y-%m-%d %H:%M:%S')] VM boot progress: Serial log has $LINES lines"
        fi
        
        sleep 1
    done
) &

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting Node.js application..."

# Run Node server in foreground
exec node /app/dist/index.js
EOF

ENTRYPOINT ["/usr/bin/tini","--"]
CMD ["/usr/local/bin/start.sh"]
