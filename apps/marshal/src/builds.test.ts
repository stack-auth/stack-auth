import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { MAX_BUILD_ENV_BYTES } from "./config.js";
import { INTERNAL_COMPLETE_PATH_PREFIX, buildEnvByteLength, buildHarnessScript, buildTimeEnv, createFlyBuilder, createMockBuilder } from "./builds.js";
import { validateDeploymentRequest, validateServiceSpec } from "./services.js";

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

  it("loops over the target manifest and branches per target on its Dockerfile", () => {
    // One machine builds every service of the deployment, reading a tab-separated
    // manifest — /bin/sh with no jq is why it is not JSON.
    // The tab comes from printf: POSIX sh does not expand \t inside double quotes, so a
    // literal IFS="\t" would split on backslash and the letter "t" instead of on tabs.
    expect(script).toContain(`TAB="$(printf '\\t')"`);
    expect(script).not.toContain('IFS="\\t"');
    // The line is read whole and cut by hand; the executed test below is what pins WHY.
    expect(script).toContain("while IFS= read -r TARGET_LINE; do");
    expect(script).toContain("done < /marshal-targets.tsv");
    expect(script).toContain('if [ -n "$DOCKERFILE_PATH" ]; then');
    expect(script).toContain('--opt "filename=$DOCKERFILE_PATH"');
    // ${VAR:-} rather than $VAR: if the env var is ever dropped (empty values are the most
    // likely casualty of a serializer), `set -u` must not kill the script before fail()
    // can report — that failure mode is a silent 20-minute hang.
    expect(script).toContain('[ -n "${BUILDKIT_TMPFS_SIZE:-}" ]');
  });

  it("names the failing target and stops the whole build there", () => {
    // The deployment fails as a unit: the services after this one depend on it,
    // and the caller needs to know WHICH target died in a shared log.
    expect(script).toContain('fail "$SERVICE_KEY: docker build failed (see the build log above)"');
    expect(script).toContain('fail "$SERVICE_KEY: railpack build failed (see the build log above)"');
    // fail() exits, so nothing after it in the loop runs.
    expect(script).toMatch(/fail\(\) \{[\s\S]*exit 1/);
  });

  it("parses a manifest whose optional fields are empty, in a real /bin/sh", () => {
    // Executed rather than pattern-matched: the failure this guards against is a shell
    // semantic (a tab is IFS WHITE SPACE, so `read -r a b c d` collapses a run of tabs and
    // shifts every later field), which no assertion about the script's text would catch.
    // The parsing lines are lifted out of the REAL script, so a regression there fails here.
    const parseStart = script.indexOf(`TAB="$(printf`);
    const parseEnd = script.indexOf("[ -n \"$SERVICE_KEY\" ] || continue");
    expect(parseStart).toBeGreaterThan(-1);
    expect(parseEnd).toBeGreaterThan(parseStart);
    const parser = script.slice(parseStart, parseEnd);

    const manifestPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "marshal-manifest-")), "targets.tsv");
    fs.writeFileSync(manifestPath, [
      // Both optional fields set, then BOTH empty (Railpack from the upload root), then only
      // root_directory set — the case that shifted fields.
      "web\tregistry.fly.io/web:tag\tweb/Dockerfile\tapps/web",
      "api\tregistry.fly.io/api:tag\t\t",
      "db\tregistry.fly.io/db:tag\t\tservices/db",
      "",
    ].join("\n"));

    const output = execFileSync("/bin/sh", ["-c", `${parser}
  echo "[$SERVICE_KEY][$PUSH_TARGET][$DOCKERFILE_PATH][$ROOT_DIRECTORY]"
done < ${JSON.stringify(manifestPath)}`], { encoding: "utf8" });

    expect(output.trim().split("\n")).toEqual([
      "[web][registry.fly.io/web:tag][web/Dockerfile][apps/web]",
      "[api][registry.fly.io/api:tag][][]",
      "[db][registry.fly.io/db:tag][][services/db]",
    ]);
  });

  it("reports one digest per target so the applies know which image is whose", () => {
    expect(script).toContain('DIGESTS="$DIGESTS\\"$SERVICE_KEY\\":\\"$DIGEST\\""');
    expect(script).toContain(`printf '{"targets":{%s}}' "$DIGESTS" > /tmp/result.json`);
    expect(script).toContain('fail "$SERVICE_KEY: the build produced no image digest"');
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
    // Per target: the directory is the argument, so one service's values are never
    // offered to another's build.
    expect(script).toContain('set -- $(secret_args "$ENV_DIR")');
  });

  it("additionally passes build args for a Dockerfile build", () => {
    // An ARG is the only thing a Dockerfile can interpolate into a RUN that inlines values.
    expect(script).toContain('set -- "$@" --opt "build-arg:${f##*/}=$(cat "$f")"');
  });

  it("hands the env to railpack detection and mounts the same names for its frontend", () => {
    expect(script).toContain('set -- "$@" --env "${f##*/}=$(cat "$f")"');
    // The frontend keys its layer cache on this build arg; without it a changed secret
    // would silently reuse the layer built from the previous one.
    expect(script).toContain('--opt "build-arg:secrets-hash=$(secrets_hash "$ENV_DIR")"');
  });

  it("tolerates a build with no env at all", () => {
    // Absent var, absent directory, and present-but-empty directory all have to reach
    // buildctl with an empty argument list rather than an unbound-variable death under
    // `set -u` or a literal "dir/*" glob argument.
    expect(script).toContain('[ -d "$1" ] || return 0');
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
    deploymentId: "01HZZZZZZZZZZZZZZZZZZZZZZZ",
    uploadId: "00000000-0000-4000-8000-000000000001",
    targets: [{
      serviceKey: "web",
      pushTarget: "registry.fly.io/hx-test-ns-web:01hzzzzzzzzzzzzzzzzzzzzzzz",
      dockerfilePath: null,
      rootDirectory: null,
      buildEnv: { NEXT_PUBLIC_API_URL: "https://api.example.com", OPENAI_API_KEY: "sk-secret" },
    }],
  };
  const lease = { assertOwned: async () => {} } as any;

  it("delivers tenant values as files and never in the machine env block", async () => {
    createMachine.mockClear();
    await createFlyBuilder().startBuild(startOptions, lease);
    const config = (createMachine.mock.calls[0] as any)[1].config;

    const files = Object.fromEntries(config.files.map((file: any) => [file.guest_path, Buffer.from(file.raw_value, "base64").toString("utf8")]));
    // Per TARGET, because one machine builds every service of the deployment: a
    // value belonging to one service must not be offered to another's build.
    expect(files["/marshal-build-env/web/NEXT_PUBLIC_API_URL"]).toBe("https://api.example.com");
    expect(files["/marshal-build-env/web/OPENAI_API_KEY"]).toBe("sk-secret");
    expect(files["/marshal-build.sh"]).toContain("MARSHAL_BUILD_START");
    // The manifest the harness loops over, one tab-separated line per target.
    expect(files["/marshal-targets.tsv"]).toBe("web\tregistry.fly.io/hx-test-ns-web:01hzzzzzzzzzzzzzzzzzzzzzzz\t\t\n");

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
    await createFlyBuilder().startBuild({
      ...startOptions,
      targets: [{ ...startOptions.targets[0], buildEnv: { SET: "x", UNSET: "" } }],
    }, lease);
    const config = (createMachine.mock.calls[0] as any)[1].config;
    const paths = config.files.map((file: any) => file.guest_path);
    expect(paths).toContain("/marshal-build-env/web/SET");
    expect(paths).not.toContain("/marshal-build-env/web/UNSET");
  });
});

describe("a deployment with several targets", () => {
  const lease = { assertOwned: async () => {} } as any;

  it("gives every target its own env directory and one manifest line", async () => {
    createMachine.mockClear();
    await createFlyBuilder().startBuild({
      ns: "ns",
      deploymentId: "01HZZZZZZZZZZZZZZZZZZZZZZZ",
      uploadId: "00000000-0000-4000-8000-000000000001",
      targets: [
        { serviceKey: "web", pushTarget: "registry.fly.io/web:rev", dockerfilePath: "apps/web/Dockerfile", rootDirectory: "apps/web", buildEnv: { WEB_ONLY: "w" } },
        { serviceKey: "api", pushTarget: "registry.fly.io/api:rev", dockerfilePath: null, rootDirectory: "apps/api", buildEnv: { API_ONLY: "a" } },
      ],
    }, lease);
    const config = (createMachine.mock.calls[0] as any)[1].config;
    const files = Object.fromEntries(config.files.map((file: any) => [file.guest_path, Buffer.from(file.raw_value, "base64").toString("utf8")]));
    expect(files["/marshal-targets.tsv"]).toBe([
      "web\tregistry.fly.io/web:rev\tapps/web/Dockerfile\tapps/web",
      "api\tregistry.fly.io/api:rev\t\tapps/api",
      "",
    ].join("\n"));
    // Neither target can see the other's values.
    expect(files["/marshal-build-env/web/WEB_ONLY"]).toBe("w");
    expect(files["/marshal-build-env/api/API_ONLY"]).toBe("a");
    expect(files["/marshal-build-env/web/API_ONLY"]).toBeUndefined();
    expect(files["/marshal-build-env/api/WEB_ONLY"]).toBeUndefined();
  });

  it("sizes the machine for Railpack when ANY target auto-detects", async () => {
    // One machine builds them all, so the largest requirement wins: a
    // Dockerfile-only guest would time out the railpack target's build.
    createMachine.mockClear();
    await createFlyBuilder().startBuild({
      ns: "ns",
      deploymentId: "01HZZZZZZZZZZZZZZZZZZZZZZZ",
      uploadId: "00000000-0000-4000-8000-000000000001",
      targets: [
        { serviceKey: "web", pushTarget: "registry.fly.io/web:rev", dockerfilePath: "Dockerfile", rootDirectory: null, buildEnv: {} },
        { serviceKey: "api", pushTarget: "registry.fly.io/api:rev", dockerfilePath: null, rootDirectory: null, buildEnv: {} },
      ],
    }, lease);
    const config = (createMachine.mock.calls[0] as any)[1].config;
    expect(config.env.BUILDKIT_TMPFS_SIZE).toBeDefined();
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

describe("the build completion webhook", () => {
  // The gate in app.ts authenticates /internal/* BEFORE any handler runs and 404s a path it
  // does not recognize, so a webhook URL the gate cannot match means no real Fly build can
  // ever complete — and nothing in e2e notices, because the mock builder completes in
  // process without crossing HTTP. Both sides derive from buildCompletionPath; this pins
  // that they still agree.
  const INTERNAL_COMPLETE_PATH_REGEX = new RegExp(`^${INTERNAL_COMPLETE_PATH_PREFIX}([^/]+)/complete$`);

  it("posts to a path the app's pre-handler auth gate accepts", async () => {
    createMachine.mockClear();
    await createFlyBuilder().startBuild({
      ns: "ns",
      deploymentId: "01HZZZZZZZZZZZZZZZZZZZZZZZ",
      uploadId: "00000000-0000-4000-8000-000000000001",
      targets: [{ serviceKey: "web", pushTarget: "registry.fly.io/hx-test-ns-web:tag", dockerfilePath: null, rootDirectory: null, buildEnv: {} }],
    }, { assertOwned: async () => {} } as any);
    const webhookUrl = new URL((createMachine.mock.calls[0] as any)[1].config.env.WEBHOOK_URL);

    const match = INTERNAL_COMPLETE_PATH_REGEX.exec(webhookUrl.pathname);
    expect(match).not.toBeNull();
    // The gate verifies the token against the id it reads out of the path, so the captured
    // group has to BE the deployment id, not merely match something.
    expect(match?.[1]).toBe("01HZZZZZZZZZZZZZZZZZZZZZZZ");
    expect(webhookUrl.searchParams.get("ns")).toBe("ns");
  });
});

describe("createMockBuilder", () => {
  it("reports a hexadecimal digest per target, whatever the service is called", async () => {
    // parseBuildImages requires /^sha256:[a-f0-9]{64}$/, and a service key is free to
    // contain letters hex does not have — a digest built by pasting ids together fails
    // every mock deployment with "the build reported no image for <service>".
    const completions: { metadataJson: string | null }[] = [];
    const builder = createMockBuilder(async (options) => void completions.push(options));
    await builder.startBuild({
      ns: "ns",
      deploymentId: "01HZZZZZZZZZZZZZZZZZZZZZZZ",
      uploadId: "00000000-0000-4000-8000-000000000001",
      targets: ["web", "api", "worker-queue"].map((serviceKey) => ({
        serviceKey, pushTarget: `registry.fly.io/hx-test-ns-${serviceKey}:tag`, dockerfilePath: null, rootDirectory: null, buildEnv: {},
      })),
    }, { assertOwned: async () => {} } as any);
    await vi.waitFor(() => expect(completions.length).toBe(1));

    const digests = JSON.parse(completions[0].metadataJson ?? "{}").targets as Record<string, string>;
    expect(Object.keys(digests).sort()).toEqual(["api", "web", "worker-queue"]);
    for (const digest of Object.values(digests)) expect(digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    // Deterministic and distinct: e2e asserts on stored image refs, and two services
    // sharing a digest would hide a mix-up in which image was applied where.
    expect(new Set(Object.values(digests)).size).toBe(3);
  });
});

describe("validateServiceSpec build env size", () => {
  const specWithEnv = (env: Record<string, unknown>) => ({
    config: { type: "serverless", min_instances: 0, max_instances: 1, ports: { "3000": {} } },
    source: { image: "registry.example.com/app@sha256:abc" },
    env,
  });

  it("rejects plain values that would not fit in the builder machine's configuration", () => {
    expect(() => validateServiceSpec(specWithEnv({ BLOB: { value: "x".repeat(MAX_BUILD_ENV_BYTES) } }))).toThrow(/over the .* limit/);
  });

  it("does not count refs, which never reach the builder", () => {
    const env: Record<string, unknown> = { BLOB: { value: "x".repeat(MAX_BUILD_ENV_BYTES - 100) } };
    for (let index = 0; index < 50; index++) env[`REF_${index}`] = { ref: "api.url:8080" };
    expect(() => validateServiceSpec(specWithEnv(env))).not.toThrow();
  });
});

describe("validateDeploymentRequest paths", () => {
  const request = (target: Record<string, unknown>) => ({
    upload_id: "00000000-0000-4000-8000-000000000001",
    targets: [{
      service_key: "web",
      spec: { config: { type: "serverless", min_instances: 0, max_instances: 1, ports: { "3000": {} } }, env: {} },
      ...target,
    }],
    order: [["web"]],
  });

  it("keeps a normalized relative dockerfile path and root directory", () => {
    const parsed = validateDeploymentRequest(request({ dockerfile_path: "docker/Dockerfile.web", root_directory: "apps/web" }));
    expect(parsed.targets[0]).toMatchObject({ dockerfile_path: "docker/Dockerfile.web", root_directory: "apps/web" });
  });

  it("omits both when not provided (Railpack mode, upload root)", () => {
    const parsed = validateDeploymentRequest(request({}));
    expect("dockerfile_path" in parsed.targets[0]).toBe(false);
    expect("root_directory" in parsed.targets[0]).toBe(false);
    // "." is the upload root written out, which is the same as saying nothing.
    expect("root_directory" in validateDeploymentRequest(request({ root_directory: "." })).targets[0]).toBe(false);
  });

  it("rejects paths that could escape or break the builder's manifest", () => {
    // Both fields reach the harness as TAB-separated manifest fields and as shell
    // variables, so a tab or a traversal segment is refused rather than escaped.
    for (const invalid of ["/abs/Dockerfile", "../Dockerfile", "a/../b", "a//b", "back\\slash", "tab\tchar", "x".repeat(513), 42]) {
      expect(() => validateDeploymentRequest(request({ dockerfile_path: invalid })), String(invalid)).toThrow(/dockerfile_path/);
      expect(() => validateDeploymentRequest(request({ root_directory: invalid })), String(invalid)).toThrow(/root_directory/);
    }
  });

  it("requires the order to list every target exactly once", () => {
    const base = request({});
    expect(() => validateDeploymentRequest({ ...base, order: [[]] })).toThrow(/every target exactly once/);
    expect(() => validateDeploymentRequest({ ...base, order: [["web"], ["web"]] })).toThrow(/every target exactly once/);
    expect(() => validateDeploymentRequest({ ...base, order: [["other"]] })).toThrow(/every target exactly once/);
  });

  it("rejects two targets naming one service", () => {
    const base = request({});
    expect(() => validateDeploymentRequest({ ...base, targets: [base.targets[0], base.targets[0]], order: [["web"]] }))
      .toThrow(/same service twice/);
  });

  it("validates each target's spec on THIS request rather than after the build", () => {
    // A five-minute build that ends in "your ports are invalid" is the failure
    // this exists to prevent.
    expect(() => validateDeploymentRequest(request({
      spec: { config: { type: "serverless", min_instances: 0, max_instances: 1, ports: { "3000": { public: true }, "5432": {} } }, env: {} },
    }))).toThrow(/may not declare any other port/);
  });
});
