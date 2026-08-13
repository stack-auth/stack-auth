import { createHmac, timingSafeEqual } from "node:crypto";
import { BUILDER_GUEST, BUILDER_IMAGE, BUILD_ENV_DIR, BUILD_TIMEOUT_SECONDS, RAILPACK_BUILDER_GUEST, RAILPACK_BUILDKIT_TMPFS_SIZE, RAILPACK_CLI_SHA256, RAILPACK_CLI_URL, RAILPACK_FRONTEND_IMAGE, getConfig, resolveNamespaceOrg } from "./config.js";
import { flyClientForNamespaceOrg } from "./fly/client.js";
import { builderAppName, builderNetworkName } from "./naming.js";
import { presignValidatedUploadGet, readSpec } from "./store.js";
import type { ReconciliationLeaseGuard } from "./reconciliation-lock.js";
import type { EnvValue } from "./types.js";

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
  // The tenant env the build gets to see (buildTimeEnv of the stored spec).
  buildEnv: Record<string, string>,
};

// ONE env channel, Vercel-style: every declared env var goes to both the build and the
// runtime, secrets included. There is deliberately no build/runtime marker on the wire and
// no allowlist of which vars qualify — a framework that inlines values (NEXT_PUBLIC_*,
// VITE_*) has to see them while it compiles, and nothing in a ServiceSpec says which vars
// those are, so guessing would just be a different way to be wrong.
//
// `{ ref }` values are the one exception, and only because they are unresolvable rather
// than withheld: a ref names an output (internal_url, url) of a service that has not been
// rolled out yet, so at build time there is nothing to resolve it to. Nothing to flag or
// reject — it simply isn't there.
export function buildTimeEnv(env: Record<string, EnvValue>): Record<string, string> {
  const entries: [string, string][] = [];
  for (const [key, value] of Object.entries(env)) {
    if ("value" in value) entries.push([key, value.value]);
  }
  return Object.fromEntries(entries);
}

export function buildEnvByteLength(env: Record<string, string>): number {
  let total = 0;
  for (const [key, value] of Object.entries(env)) {
    total += Buffer.byteLength(key, "utf8") + Buffer.byteLength(value, "utf8");
  }
  return total;
}

export type Builder = {
  name: string,
  startBuild: (options: StartBuildOptions, lease: ReconciliationLeaseGuard) => Promise<{ builderApp: string | null, builderMachineId: string | null }>,
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
// Its stdout doubles as the live build log (Fly logs API). The machine's env block carries
// only Marshal's own credentials (tarball URL, registry auth, webhook callback) — the
// TENANT's env arrives as files instead, one per var under $BUILD_ENV_DIR, so that a value
// can never be confused with a credential and `env` in a log dump stays free of both.
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
# Tenant build-time env. One file per var, filename = var name, contents = the exact value.
# Every var is offered to the build as a BuildKit SECRET whose id is the var name, which is
# how a value reaches a build step without being written into an image layer. A Dockerfile
# build additionally gets each one as a --build-arg: an ARG is the only channel a framework
# that INLINES values (NEXT_PUBLIC_*, VITE_*) can read.
# Nothing here echoes a value; the two helpers print only names and paths.
BUILD_ENV_DIR_OK=0
if [ -n "\${BUILD_ENV_DIR:-}" ] && [ -d "\${BUILD_ENV_DIR:-}" ]; then BUILD_ENV_DIR_OK=1; fi
# Deliberately unquoted at the call site: word-splitting IS the mechanism, and var names
# (and the fixed dir) contain no whitespace, so each printf below becomes exactly two words.
secret_args() {
  [ "$BUILD_ENV_DIR_OK" = 1 ] || return 0
  for f in "$BUILD_ENV_DIR"/*; do
    [ -f "$f" ] || continue
    printf ' --secret id=%s,src=%s' "\${f##*/}" "$f"
  done
}
# Railpack's frontend keys its layer cache on this: without it, a changed secret would reuse
# the layer built from the old one. Every builder here is ephemeral so there is no cache to
# poison today, but the frontend's contract is what it is and the hash is nearly free.
secrets_hash() {
  [ "$BUILD_ENV_DIR_OK" = 1 ] || return 0
  for f in "$BUILD_ENV_DIR"/*; do
    [ -f "$f" ] || continue
    printf '%s=' "\${f##*/}"; cat "$f"; printf '\\n'
  done | sha256sum | cut -d' ' -f1
}
if [ -n "\${DOCKERFILE_PATH:-}" ]; then
  [ -f "$DOCKERFILE_PATH" ] || fail "no Dockerfile found at $DOCKERFILE_PATH in the source tarball"
  set -- $(secret_args)
  if [ "$BUILD_ENV_DIR_OK" = 1 ]; then
    for f in "$BUILD_ENV_DIR"/*; do
      [ -f "$f" ] || continue
      # \$(cat) drops trailing newlines — a build ARG is a command-line string, so a value
      # ending in one cannot survive this channel. The secret mount above is byte-exact.
      set -- "$@" --opt "build-arg:\${f##*/}=$(cat "$f")"
    done
  fi
  if ! buildctl build --frontend dockerfile.v0 --local context=. --local dockerfile=. \\
      --opt "filename=$DOCKERFILE_PATH" "$@" \\
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
  # railpack sees the env twice, for two different reasons. Here, --env is what DETECTION
  # reads (a NODE_VERSION or a RAILPACK_* knob changes the plan it emits) and what makes it
  # list each name in the plan's "secrets"; the values themselves never enter the plan file.
  # Below, buildctl supplies those same names as secret mounts, which the railpack frontend
  # exposes as environment variables on every build step — that is the channel a "next
  # build" actually reads NEXT_PUBLIC_* from.
  set --
  if [ "$BUILD_ENV_DIR_OK" = 1 ]; then
    for f in "$BUILD_ENV_DIR"/*; do
      [ -f "$f" ] || continue
      set -- "$@" --env "\${f##*/}=$(cat "$f")"
    done
  fi
  if ! ( unset REGISTRY_AUTH_B64 WEBHOOK_TOKEN WEBHOOK_URL TARBALL_URL; /tmp/railpack-bin/railpack prepare . --plan-out /tmp/railpack-plan/railpack-plan.json "$@" 2>&1 ); then
    fail "railpack could not determine how to build this service (see the log above) — add a Dockerfile and set dockerfilePath in your services export, or configure detection with a railpack.json (https://railpack.com)"
  fi
  set -- $(secret_args)
  if [ "$#" -gt 0 ]; then set -- "$@" --opt "build-arg:secrets-hash=$(secrets_hash)"; fi
  if ! buildctl build --frontend gateway.v0 --opt "source=$RAILPACK_FRONTEND_IMAGE" \\
      --local context=. --local dockerfile=/tmp/railpack-plan "$@" \\
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
    async startBuild(options, lease) {
      const config = getConfig();
      if (config.publicUrl === null) {
        throw new Error("MARSHAL_PUBLIC_URL must be set for real Fly builds — the builder machine calls the completion webhook on it");
      }
      const org = resolveNamespaceOrg(options.ns);
      const fly = flyClientForNamespaceOrg(org);
      const builderApp = builderAppName(config.envId);
      await lease.assertOwned();
      await fly.ensureApp(builderApp, builderNetworkName(config.envId));

      const tarballUrl = await presignValidatedUploadGet(options.ns, options.buildId, BUILD_TIMEOUT_SECONDS + 60);
      const webhookToken = computeWebhookToken(options.buildId, options.ns, options.key);
      const webhookUrl = `${config.publicUrl}/internal/builds/${options.buildId}/complete?ns=${encodeURIComponent(options.ns)}&key=${encodeURIComponent(options.key)}`;

      const isRailpackBuild = options.dockerfilePath === null;
      await lease.assertOwned();
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
          files: [
            {
              guest_path: "/marshal-build.sh",
              raw_value: Buffer.from(buildHarnessScript()).toString("base64"),
            },
            // Tenant env, one file per var. NOT in the env block below: that one holds
            // Marshal's org token and registry auth, and a tenant value sitting next to
            // them is one careless `env` away from being logged as a credential — and one
            // careless credential away from being handed to `railpack prepare`, which runs
            // unsandboxed in the harness.
            // An EMPTY value is skipped: it would mean a files entry whose raw_value is the
            // empty string, which the API is free to read as "no content supplied" rather
            // than "supplied, and empty". There is nothing to inline either way, and the
            // runtime env still carries the var — so the ambiguity is simply not worth
            // entering. The harness's `[ -f "$f" ]` guard makes the absence a non-event.
            ...Object.entries(options.buildEnv).flatMap(([key, value]) => value === "" ? [] : [{
              guest_path: `${BUILD_ENV_DIR}/${key}`,
              raw_value: Buffer.from(value, "utf8").toString("base64"),
            }]),
          ],
          metadata: { marshal_build_id: options.buildId },
          env: {
            // A path, not a value: the harness reads the values out of the files above.
            BUILD_ENV_DIR,
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
    async startBuild(options, lease) {
      await lease.assertOwned();
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
