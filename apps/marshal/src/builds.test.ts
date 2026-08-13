import { describe, expect, it, vi } from "vitest";
import { MAX_BUILD_ENV_BYTES } from "./config.js";
import { buildEnvByteLength, buildHarnessScript, buildTimeEnv, createFlyBuilder } from "./builds.js";
import { validateServiceSpec } from "./services.js";

// startBuild reaches for Marshal's Fly client, config, and object store through module
// singletons, so the machine-config assertions below need all three stubbed. Only getConfig
// and resolveNamespaceOrg are overridden in config — the module's pinned constants
// (BUILDER_IMAGE, the railpack pins) are the real ones, which is the point of the test.
const createMachine = vi.fn(async () => ({ id: "machine-1" }));
vi.mock("./config.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("./config.js")>(),
  getConfig: () => ({
    envId: "test",
    publicUrl: "https://marshal.example.com",
    webhookSecret: "webhook-secret",
    fly: { region: "iad", registryHost: "registry.fly.io", token: "FlyV1 org-token" },
  }),
  resolveNamespaceOrg: () => ({ orgSlug: "org", token: "FlyV1 org-token" }),
}));
vi.mock("./fly/client.js", () => ({
  flyClientForNamespaceOrg: () => ({
    ensureApp: async () => {},
    createMachine,
    registryAuthBase64: () => "registry-auth-blob",
  }),
}));
vi.mock("./store.js", () => ({
  presignValidatedUploadGet: async () => "https://bucket.example.com/src.tar.gz?X-Amz-Signature=deadbeef",
  readSpec: async () => null,
}));

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

describe("buildHarnessScript build-time env", () => {
  const script = buildHarnessScript();

  it("offers every var to buildkit as a secret whose id is the var name", () => {
    // A secret mount is the channel that does NOT write the value into an image layer, so
    // it is the one every var gets in both build modes.
    expect(script).toContain("printf ' --secret id=%s,src=%s'");
    expect(script).toContain("set -- $(secret_args)");
  });

  it("additionally passes build args for a Dockerfile build", () => {
    // An ARG is the only thing a Dockerfile can interpolate into a RUN that inlines values.
    expect(script).toContain('set -- "$@" --opt "build-arg:${f##*/}=$(cat "$f")"');
  });

  it("hands the env to railpack detection and mounts the same names for its frontend", () => {
    expect(script).toContain('set -- "$@" --env "${f##*/}=$(cat "$f")"');
    // The frontend keys its layer cache on this build arg; without it a changed secret
    // would silently reuse the layer built from the previous one.
    expect(script).toContain('--opt "build-arg:secrets-hash=$(secrets_hash)"');
  });

  it("tolerates a build with no env at all", () => {
    // Absent var, absent directory, and present-but-empty directory all have to reach
    // buildctl with an empty argument list rather than an unbound-variable death under
    // `set -u` or a literal "dir/*" glob argument.
    expect(script).toContain('if [ -n "${BUILD_ENV_DIR:-}" ] && [ -d "${BUILD_ENV_DIR:-}" ]; then BUILD_ENV_DIR_OK=1; fi');
    expect(script).toContain('[ -f "$f" ] || continue');
    expect(script).toContain('if [ "$#" -gt 0 ]; then');
  });

  it("never echoes a value", () => {
    // The harness's stdout IS the build log. Values are read with cat into an argument,
    // never printed; the only things printed alongside them are names and paths.
    expect(script).not.toMatch(/echo[^\n]*\$\(cat "\$f"\)/);
  });
});

describe("createFlyBuilder machine configuration", () => {
  const startOptions = {
    ns: "ns",
    key: "web",
    buildId: "01HZZZZZZZZZZZZZZZZZZZZZZZ",
    revision: "abc123",
    appName: "hx-test-ns-web",
    uploadId: "00000000-0000-4000-8000-000000000001",
    dockerfilePath: null,
    buildEnv: { NEXT_PUBLIC_API_URL: "https://api.example.com", OPENAI_API_KEY: "sk-secret" },
  };
  const lease = { assertOwned: async () => {} } as any;

  it("delivers tenant values as files and never in the machine env block", async () => {
    createMachine.mockClear();
    await createFlyBuilder().startBuild(startOptions, lease);
    const config = (createMachine.mock.calls[0] as any)[1].config;

    const files = Object.fromEntries(config.files.map((file: any) => [file.guest_path, Buffer.from(file.raw_value, "base64").toString("utf8")]));
    expect(files["/marshal-build-env/NEXT_PUBLIC_API_URL"]).toBe("https://api.example.com");
    expect(files["/marshal-build-env/OPENAI_API_KEY"]).toBe("sk-secret");
    expect(files["/marshal-build.sh"]).toContain("MARSHAL_BUILD_START");

    // The env block is Marshal's own credentials plus pointers. A tenant value landing
    // here would sit next to the org token and reach `railpack prepare`, which runs
    // unsandboxed in the harness — so assert the absence, not just the files' presence.
    expect(config.env.BUILD_ENV_DIR).toBe("/marshal-build-env");
    expect(Object.values(config.env)).not.toContain("sk-secret");
    expect(Object.values(config.env)).not.toContain("https://api.example.com");
    expect(Object.keys(config.env)).not.toContain("OPENAI_API_KEY");
  });

  it("skips an empty value rather than sending an ambiguous empty file", async () => {
    createMachine.mockClear();
    await createFlyBuilder().startBuild({ ...startOptions, buildEnv: { SET: "x", UNSET: "" } }, lease);
    const config = (createMachine.mock.calls[0] as any)[1].config;
    const paths = config.files.map((file: any) => file.guest_path);
    expect(paths).toContain("/marshal-build-env/SET");
    expect(paths).not.toContain("/marshal-build-env/UNSET");
  });
});

describe("buildTimeEnv", () => {
  it("takes plain values and drops refs", () => {
    // One channel: every declared var goes to the build AND the runtime, secrets included.
    // A ref is excluded only because it names an output that does not exist yet.
    expect(buildTimeEnv({
      PLAIN: { value: "keep-me" },
      SECRET: { value: "sk-also-keep-me" },
      CONNECTION: { ref: "api.internal_url" },
    })).toEqual({ PLAIN: "keep-me", SECRET: "sk-also-keep-me" });
  });

  it("measures keys and values in utf-8 bytes", () => {
    expect(buildEnvByteLength({ K: "é" })).toBe(3);
  });
});

describe("validateServiceSpec build env size", () => {
  const specWithEnv = (env: Record<string, unknown>) => ({
    config: { type: "serverless", min_instances: 0, max_instances: 1, ports: [{ port: 3000 }] },
    source: { upload_id: "00000000-0000-4000-8000-000000000001" },
    env,
  });

  it("rejects plain values that would not fit in the builder machine's configuration", () => {
    expect(() => validateServiceSpec(specWithEnv({ BLOB: { value: "x".repeat(MAX_BUILD_ENV_BYTES) } }))).toThrow(/over the .* limit/);
  });

  it("does not count refs, which never reach the builder", () => {
    const env: Record<string, unknown> = { BLOB: { value: "x".repeat(MAX_BUILD_ENV_BYTES - 100) } };
    for (let index = 0; index < 50; index++) env[`REF_${index}`] = { ref: "api.internal_url" };
    expect(() => validateServiceSpec(specWithEnv(env))).not.toThrow();
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
