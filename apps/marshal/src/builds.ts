import { createHmac, timingSafeEqual } from "node:crypto";
import { BUILDER_GUEST, BUILDER_IMAGE, BUILD_TIMEOUT_SECONDS, RAILPACK_BUILDER_GUEST, RAILPACK_BUILDKIT_TMPFS_SIZE, RAILPACK_CLI_SHA256, RAILPACK_CLI_URL, RAILPACK_FRONTEND_IMAGE, getConfig, resolveNamespaceOrg } from "./config.js";
import { flyClientForNamespaceOrg } from "./fly/client.js";
import { builderAppName, builderNetworkName } from "./naming.js";
import { presignValidatedUploadGet, readSpec } from "./store.js";

// Builders start a build for an uploaded source tarball; completion always flows through
// the webhook path (POST /internal/builds/:id/complete → services.completeBuild), so the
// two implementations stay behaviorally identical:
//  - fly:  ephemeral per-build Machine running BuildKit; the machine calls the webhook.
//  - mock: dev/e2e only; "completes" in-process on the next tick with a deterministic
//          fake digest (the fly-mock accepts any image ref).

export type StartBuildOptions = {
  ns: string,
  key: string,
  buildId: string,
  revision: string,
  appName: string,
  uploadId: string,
  // Tarball-root-relative Dockerfile to build from; null = Railpack auto-detection.
  dockerfilePath: string | null,
};

export type Builder = {
  name: string,
  startBuild: (options: StartBuildOptions) => Promise<{ builderApp: string | null, builderMachineId: string | null }>,
};

// Per-build webhook token: HMAC over (buildId, ns, key) so a stolen token can't complete a
// different build, and Marshal can verify statelessly.
export function computeWebhookToken(buildId: string, ns: string, key: string): string {
  return createHmac("sha256", getConfig().webhookSecret).update(`${buildId}\0${ns}\0${key}`).digest("hex");
}

export function verifyWebhookToken(token: string, buildId: string, ns: string, key: string): boolean {
  const expected = computeWebhookToken(buildId, ns, key);
  const provided = Buffer.from(token, "utf8");
  const wanted = Buffer.from(expected, "utf8");
  return provided.length === wanted.length && timingSafeEqual(provided, wanted);
}

// The harness: BuildKit plus a small shell wrapper, injected via the machine `files` API.
// Its stdout doubles as the live build log (Fly logs API). It never receives tenant env
// values — only the tarball URL, registry credentials, and the webhook callback.
// On success it POSTs buildctl's metadata JSON (which contains containerimage.digest);
// Marshal falls back to a registry HEAD if that ever comes back unparseable.
//
// Two build modes, selected by DOCKERFILE_PATH:
//  - non-empty: a classic Dockerfile build (dockerfile.v0 frontend, --opt filename).
//  - empty: Railpack auto-detection — the pinned railpack CLI analyzes the source into a
//    build plan that the pinned railpack BuildKit frontend executes. No Dockerfile is ever
//    picked up implicitly.
export function buildHarnessScript(): string {
  return `#!/bin/sh
set -u
webhook() {
  wget -qO- --header "Authorization: Bearer $WEBHOOK_TOKEN" --header "Content-Type: $2" \\
    --post-file "$3" "$WEBHOOK_URL&status=$1" || \\
  wget -qO- --header "Authorization: Bearer $WEBHOOK_TOKEN" --header "Content-Type: $2" \\
    --post-file "$3" "$WEBHOOK_URL&status=$1" || true
}
fail() {
  echo "MARSHAL_BUILD_FAILED: $1"
  printf '%s' "$1" > /tmp/error.txt
  webhook failed text/plain /tmp/error.txt
  exit 1
}
( sleep "$BUILD_TIMEOUT_SECONDS"
  echo "MARSHAL_BUILD_TIMEOUT"
  printf '%s' "build timed out after $BUILD_TIMEOUT_SECONDS seconds" > /tmp/timeout.txt
  webhook failed text/plain /tmp/timeout.txt
  kill -9 -1 ) &
echo "MARSHAL_BUILD_START"
# The machine rootfs is an overlayfs, which buildkit cannot use as a snapshotter upperdir —
# it silently falls back to the native (full-copy-per-layer) snapshotter, slow enough that
# large base images time the build out. A tmpfs at /var/lib/buildkit restores the overlayfs
# snapshotter; sized by the machine RAM that backs it (Railpack builds get a bigger guest).
if [ -n "\${BUILDKIT_TMPFS_SIZE:-}" ]; then
  mkdir -p /var/lib/buildkit
  mount -t tmpfs -o "size=$BUILDKIT_TMPFS_SIZE" tmpfs /var/lib/buildkit || echo "MARSHAL_TMPFS_MOUNT_FAILED (continuing on the slow disk-backed snapshotter)"
fi
buildkitd >/tmp/buildkitd.log 2>&1 &
i=0
until buildctl debug workers >/dev/null 2>&1; do
  i=$((i+1)); [ $i -gt 60 ] && fail "buildkitd did not start"
  sleep 1
done
mkdir -p /ctx
# Fetch and extract OUTSIDE the context dir, then extract INTO it — otherwise the tarball
# itself sits in the build context and a plain \`COPY . .\` bakes a compressed copy of the
# whole source tree into the user's image.
# Marshal validates the archive and copies it to an immutable, build-specific object before
# this machine receives credentials. The original client-writable upload is never extracted.
wget -q -O /tmp/ctx.tar.gz "$TARBALL_URL" || fail "failed to fetch the source tarball"
tar xzf /tmp/ctx.tar.gz -C /ctx || fail "the source tarball is not a valid gzipped tarball"
cd /ctx
mkdir -p /root/.docker
printf '{"auths":{"%s":{"auth":"%s"}}}' "$REGISTRY_HOST" "$REGISTRY_AUTH_B64" > /root/.docker/config.json
if [ -n "\${DOCKERFILE_PATH:-}" ]; then
  [ -f "$DOCKERFILE_PATH" ] || fail "no Dockerfile found at $DOCKERFILE_PATH in the source tarball"
  if ! buildctl build --frontend dockerfile.v0 --local context=. --local dockerfile=. \\
      --opt "filename=$DOCKERFILE_PATH" \\
      --output "type=image,name=$PUSH_TARGET,push=true" --metadata-file /tmp/md.json 2>&1; then
    fail "docker build failed (see the build log above)"
  fi
else
  echo "MARSHAL_RAILPACK_DETECT"
  wget -q -O /tmp/railpack.tar.gz "$RAILPACK_CLI_URL" || wget -q -O /tmp/railpack.tar.gz "$RAILPACK_CLI_URL" || fail "failed to fetch the railpack CLI (a build-infrastructure problem, not an issue with your code)"
  echo "$RAILPACK_CLI_SHA256  /tmp/railpack.tar.gz" | sha256sum -c - >/dev/null 2>&1 || fail "the railpack CLI download failed checksum verification (a build-infrastructure problem, not an issue with your code)"
  mkdir -p /tmp/railpack-bin
  tar xzf /tmp/railpack.tar.gz -C /tmp/railpack-bin || fail "failed to extract the railpack CLI (a build-infrastructure problem, not an issue with your code)"
  [ -x /tmp/railpack-bin/railpack ] || fail "the railpack CLI archive did not contain the expected binary (a build-infrastructure problem, not an issue with your code)"
  # The plan gets its own directory: it is transferred to the frontend as the whole
  # "dockerfile" local, which must not drag /tmp scratch files along. The CLI runs in a
  # subshell with the build credentials stripped — unlike Dockerfile RUN steps (sandboxed by
  # buildkit), it executes directly in this harness, and it has no business seeing them.
  mkdir -p /tmp/railpack-plan
  if ! ( unset REGISTRY_AUTH_B64 WEBHOOK_TOKEN WEBHOOK_URL TARBALL_URL; /tmp/railpack-bin/railpack prepare . --plan-out /tmp/railpack-plan/railpack-plan.json 2>&1 ); then
    fail "railpack could not determine how to build this service (see the log above) — add a Dockerfile and set dockerfilePath in your services export, or configure detection with a railpack.json (https://railpack.com)"
  fi
  if ! buildctl build --frontend gateway.v0 --opt "source=$RAILPACK_FRONTEND_IMAGE" \\
      --local context=. --local dockerfile=/tmp/railpack-plan \\
      --output "type=image,name=$PUSH_TARGET,push=true" --metadata-file /tmp/md.json 2>&1; then
    fail "railpack build failed (see the build log above)"
  fi
fi
webhook succeeded application/json /tmp/md.json
echo "MARSHAL_BUILD_DONE"
`;
}

export function createFlyBuilder(): Builder {
  return {
    name: "fly",
    async startBuild(options) {
      const config = getConfig();
      if (config.publicUrl === null) {
        throw new Error("MARSHAL_PUBLIC_URL must be set for real Fly builds — the builder machine calls the completion webhook on it");
      }
      const org = resolveNamespaceOrg(options.ns);
      const fly = flyClientForNamespaceOrg(org);
      const builderApp = builderAppName(config.envId);
      await fly.ensureApp(builderApp, builderNetworkName(config.envId));

      const tarballUrl = await presignValidatedUploadGet(options.ns, options.buildId, BUILD_TIMEOUT_SECONDS + 60);
      const webhookToken = computeWebhookToken(options.buildId, options.ns, options.key);
      const webhookUrl = `${config.publicUrl}/internal/builds/${options.buildId}/complete?ns=${encodeURIComponent(options.ns)}&key=${encodeURIComponent(options.key)}`;

      const isRailpackBuild = options.dockerfilePath === null;
      const machine = await fly.createMachine(builderApp, {
        name: `build-${options.buildId.toLowerCase()}`,
        region: config.fly.region,
        config: {
          image: BUILDER_IMAGE,
          guest: isRailpackBuild ? RAILPACK_BUILDER_GUEST : BUILDER_GUEST,
          // One microVM per build = tenant isolation; auto_destroy reclaims it on exit
          // (logs survive destruction — smoke-verified).
          auto_destroy: true,
          restart: { policy: "no" },
          init: { exec: ["/bin/sh", "/marshal-build.sh"] },
          files: [{
            guest_path: "/marshal-build.sh",
            raw_value: Buffer.from(buildHarnessScript()).toString("base64"),
          }],
          metadata: { marshal_build_id: options.buildId },
          env: {
            TARBALL_URL: tarballUrl,
            PUSH_TARGET: `${config.fly.registryHost}/${options.appName}:${options.revision}`,
            REGISTRY_HOST: config.fly.registryHost,
            REGISTRY_AUTH_B64: fly.registryAuthBase64(),
            WEBHOOK_URL: webhookUrl,
            WEBHOOK_TOKEN: webhookToken,
            BUILD_TIMEOUT_SECONDS: String(BUILD_TIMEOUT_SECONDS),
            // Empty = Railpack auto-detection (the harness branches on emptiness, and
            // tolerates the var being dropped entirely — see \${DOCKERFILE_PATH:-}).
            DOCKERFILE_PATH: options.dockerfilePath ?? "",
            RAILPACK_CLI_URL,
            RAILPACK_CLI_SHA256,
            RAILPACK_FRONTEND_IMAGE,
            ...(isRailpackBuild ? { BUILDKIT_TMPFS_SIZE: RAILPACK_BUILDKIT_TMPFS_SIZE } : {}),
          },
        },
      });
      return { builderApp, builderMachineId: machine.id };
    },
  };
}

export type CompleteBuildFn = (options: {
  ns: string,
  key: string,
  buildId: string,
  status: "succeeded" | "failed",
  metadataJson: string | null,
  errorText: string | null,
}) => Promise<void>;

export function createMockBuilder(completeBuild: CompleteBuildFn): Builder {
  return {
    name: "mock",
    async startBuild(options) {
      // Test hook: a spec whose env declares MARSHAL_MOCK_FAIL_BUILD fails the build —
      // the only way e2e can exercise the failure path with an instant fake builder.
      const stored = await readSpec(options.ns, options.key);
      const shouldFail = stored !== null && Object.hasOwn(stored.spec.env, "MARSHAL_MOCK_FAIL_BUILD");
      // Deterministic fake digest so e2e assertions and revision→image mapping are stable.
      const fakeDigest = `sha256:${"0".repeat(64 - options.revision.length)}${options.revision}`;
      // Complete on the next tick, mirroring the real flow's asynchrony without making the
      // PUT response wait on machine rollout.
      setTimeout(() => {
        // eslint-disable-next-line @typescript-eslint/no-floating-promises -- errors are handled inside
        (async () => {
          try {
            await completeBuild({
              ns: options.ns,
              key: options.key,
              buildId: options.buildId,
              status: shouldFail ? "failed" : "succeeded",
              metadataJson: shouldFail ? null : JSON.stringify({ "containerimage.digest": fakeDigest }),
              errorText: shouldFail ? "mock build failed (the spec declares MARSHAL_MOCK_FAIL_BUILD)" : null,
            });
          } catch (error) {
            console.error(`mock builder: completing build ${options.buildId} failed`, error);
          }
        })();
      }, 0);
      return { builderApp: null, builderMachineId: null };
    },
  };
}
