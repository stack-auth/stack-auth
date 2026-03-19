# CLAUDE-KNOWLEDGE

## Q: How should QEMU local-emulator containers reach host-only dev services like the OAuth mock server?
A: Keep container-local dependencies on `127.0.0.1`, but point host-only services at QEMU's user-network host alias `10.0.2.2`. Using `127.0.0.1:${PORT}` for host services from inside the guest container points back at the container itself.
