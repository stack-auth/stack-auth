# QEMU Local Emulator

The local emulator packages the entire Stack Auth backend (PostgreSQL, Redis, ClickHouse, MinIO, Inbucket, Svix, QStash, Dashboard, and Backend) into a single QEMU virtual machine image. Users run it via the `stack emulator` CLI commands.

## Architecture

```
Host machine
 └─ QEMU VM (Debian 13 cloud image)
     └─ Docker container (all-in-one image from ../Dockerfile)
         ├─ PostgreSQL 16
         ├─ Redis 7
         ├─ ClickHouse
         ├─ MinIO
         ├─ Inbucket
         ├─ Svix
         ├─ QStash
         ├─ Stack Dashboard  (→ host:26700)
         └─ Stack Backend    (→ host:26701)
```

Only four services are exposed to the host via port forwarding:

| Service   | Host Port | Description              |
|-----------|-----------|--------------------------|
| Dashboard | 26700     | Stack Auth dashboard UI  |
| Backend   | 26701     | Stack Auth API server    |
| MinIO     | 26702     | S3-compatible storage    |
| Inbucket  | 26703     | Email testing interface  |

All other services (PostgreSQL, Redis, ClickHouse, Svix, QStash) remain internal to the VM.

## Scripts

| Script             | Purpose                                                        |
|--------------------|----------------------------------------------------------------|
| `build-image.sh`   | Builds a QEMU disk image for a target architecture             |
| `run-emulator.sh`  | Manages the VM lifecycle: `start`, `stop`, `reset`, `status`, `bench` |
| `common.sh`        | Shared helpers: host detection, QEMU binary selection, firmware lookup, ISO creation |

## Building an Image

```bash
# Build for current architecture
./docker/local-emulator/qemu/build-image.sh

# Build for a specific architecture (arm64 or amd64)
./docker/local-emulator/qemu/build-image.sh arm64

# Build both
./docker/local-emulator/qemu/build-image.sh both
```

The build process:
1. Builds the all-in-one Docker image from `../Dockerfile` and exports it as a tarball
2. Downloads a Debian 13 cloud base image
3. Boots a QEMU VM with cloud-init provisioning (`cloud-init/emulator/user-data`)
4. Cloud-init loads the Docker image and runs a full startup cycle to warm caches
5. Shuts down and compresses the disk image to `images/stack-emulator-<arch>.qcow2`

Default resources: 4 CPUs, 4096 MB RAM. Override with `EMULATOR_CPUS` / `EMULATOR_RAM_MB`.

### Why a single Docker image?

The `../Dockerfile` bundles all services into one image rather than using separate containers. This keeps the QEMU disk image size small — separate images would each carry their own base layers, significantly inflating the final qcow2.

## Running the Emulator

```bash
# Via CLI (recommended)
stack emulator start
stack emulator stop
stack emulator reset   # wipe data
stack emulator status

# Via script directly
EMULATOR_ARCH=arm64 ./docker/local-emulator/qemu/run-emulator.sh start
```

The VM uses an overlay disk (`run/vm/disk.qcow2`) on top of the base image, so data persists across stop/start cycles. Use `reset` to wipe the overlay and start fresh.

### Hardware acceleration

- **macOS**: Uses HVF (Hypervisor.framework) for native-arch VMs
- **Linux**: Uses KVM when available
- **Cross-arch**: Falls back to TCG (software emulation) — significantly slower

## Optimizations Taken

- **Single bundled Docker image** to minimize qcow2 size
- **Cloud-init provisioning** pre-warms all services during build so first boot is fast
- **Overlay disks** avoid copying the multi-GB base image on each start
- **Compressed qcow2** images (`-c` flag) reduce download size
- **Only 4 ports forwarded** to minimize host-side surface area

## Possible Future Optimizations

- External server for reads and writes to relative dir instead of full host access allowing snapshots
    - Or copying the config file on start with --config-file <path> enforced and writing the config file to host directory on stop

## Updating the Image

1. Make changes to the `../Dockerfile`, `../entrypoint.sh`, or cloud-init config
2. Rebuild: `./docker/local-emulator/qemu/build-image.sh <arch>`
3. The CI workflow (`.github/workflows/qemu-emulator-build.yaml`) builds and publishes images on push to `main`/`dev`
4. Users pull the latest via `stack emulator pull`

## Directory Layout

```
qemu/
├── build-image.sh          # Image builder
├── run-emulator.sh         # VM lifecycle manager
├── common.sh               # Shared utilities
├── cloud-init/
│   └── emulator/
│       ├── meta-data        # VM instance metadata
│       └── user-data        # Provisioning script
├── images/                  # Built qcow2 images (gitignored)
└── run/                     # Runtime state: overlay disk, PID, logs (gitignored)
```
