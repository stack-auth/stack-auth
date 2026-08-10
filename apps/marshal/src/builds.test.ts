import { describe, expect, it } from "vitest";
import { buildHarnessScript } from "./builds.js";
import { validateServiceSpec } from "./services.js";

// The harness script itself only runs on a real Fly builder machine, so these tests pin its
// shape (both build modes, credential stripping, checksum verification) rather than its
// behavior — a regression here means the real builder changed in a way QA must re-verify.
describe("buildHarnessScript", () => {
  const script = buildHarnessScript();

  it("branches on DOCKERFILE_PATH with an unset-tolerant default", () => {
    // ${VAR:-} rather than $VAR: if the env var is ever dropped (empty values are the most
    // likely casualty of a serializer), `set -u` must not kill the script before fail()
    // can report — that failure mode is a silent 20-minute hang.
    expect(script).toContain('[ -n "${DOCKERFILE_PATH:-}" ]');
    expect(script).toContain('[ -n "${BUILDKIT_TMPFS_SIZE:-}" ]');
    expect(script).toContain('--opt "filename=$DOCKERFILE_PATH"');
  });

  it("verifies the railpack CLI checksum before executing it", () => {
    expect(script).toContain("sha256sum -c");
    expect(script).toMatch(/sha256sum -c[^\n]*\n[^\n]*railpack/);
  });

  it("strips build credentials from the railpack prepare subshell", () => {
    expect(script).toContain("unset REGISTRY_AUTH_B64 WEBHOOK_TOKEN WEBHOOK_URL TARBALL_URL");
  });

  it("mounts a tmpfs for the buildkit snapshotter when sized", () => {
    // Without this, the overlayfs rootfs forces buildkit's native (full-copy) snapshotter
    // and large base-image extraction alone exceeds the build timeout (real-Fly QA).
    expect(script).toContain("mount -t tmpfs");
    expect(script).toContain("/var/lib/buildkit");
  });
});

describe("validateServiceSpec dockerfile_path", () => {
  const baseSpec = {
    config: { type: "serverless", min_instances: 0, max_instances: 1, ports: [{ port: 3000 }] },
    source: { upload_id: "00000000-0000-4000-8000-000000000001" },
    env: {},
  };
  const withDockerfilePath = (dockerfilePath: unknown) => ({
    ...baseSpec,
    source: { ...baseSpec.source, dockerfile_path: dockerfilePath },
  });

  it("accepts a normalized relative path and keeps it on the spec", () => {
    const spec = validateServiceSpec(withDockerfilePath("docker/Dockerfile.web"));
    expect(spec.source).toEqual({ upload_id: "00000000-0000-4000-8000-000000000001", dockerfile_path: "docker/Dockerfile.web" });
  });

  it("omits the field entirely when not provided (Railpack mode)", () => {
    const spec = validateServiceSpec(baseSpec);
    expect(spec.source).toEqual({ upload_id: "00000000-0000-4000-8000-000000000001" });
    expect("dockerfile_path" in spec.source).toBe(false);
  });

  it("rejects non-normalized and unsafe paths", () => {
    for (const invalid of ["", "/abs/Dockerfile", "../Dockerfile", "a/../b", ".", "./Dockerfile", "a//b", "back\\slash", "tab\tchar", "x".repeat(513), 42]) {
      expect(() => validateServiceSpec(withDockerfilePath(invalid))).toThrow(/dockerfile_path/);
    }
  });

  it("rejects dockerfile_path on an image source", () => {
    expect(() => validateServiceSpec({
      ...baseSpec,
      source: { image: "registry.example.com/app@sha256:abc", dockerfile_path: "Dockerfile" },
    })).toThrow(/only valid together with source.upload_id/);
  });
});
