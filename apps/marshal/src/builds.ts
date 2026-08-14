import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { BUILDER_GUEST, BUILDER_IMAGE, BUILD_ENV_DIR, BUILD_TIMEOUT_SECONDS, RAILPACK_BUILDER_GUEST, RAILPACK_BUILDKIT_TMPFS_SIZE, RAILPACK_CLI_SHA256, RAILPACK_CLI_URL, RAILPACK_FRONTEND_IMAGE, getConfig, resolveNamespaceOrg } from "./config.js";
import { flyClientForNamespaceOrg } from "./fly/client.js";
import { builderAppName, builderNetworkName } from "./naming.js";
import { presignValidatedUploadGet } from "./store.js";
import type { ReconciliationLeaseGuard } from "./reconciliation-lock.js";
import type { EnvValue } from "./types.js";

// The completion webhook's path, in one place. app.ts authenticates /internal/* in
// onRequest, BEFORE any handler runs, by matching this prefix — so a path that only the
// route below knows about is rejected as an unknown internal route and no build can ever
// complete. Both sides derive from this constant rather than re-typing the path.
export const INTERNAL_COMPLETE_PATH_PREFIX = "/internal/deployments/";

/** Where the builder harness POSTs its completion for `deploymentId`. */
export function buildCompletionPath(deploymentId: string): string {
  return `${INTERNAL_COMPLETE_PATH_PREFIX}${deploymentId}/complete`;
}

// Builders start a build for an uploaded source tarball; completion always flows through
// the webhook path (POST /internal/deployments/:deploymentId/complete →
// services.completeBuild), so the two implementations stay behaviorally identical:
//  - fly:  ephemeral per-build Machine running BuildKit; the machine calls the webhook.
//  - mock: dev/e2e only; "completes" in-process on the next tick with a deterministic
//          fake digest (the fly-mock accepts any image ref).

// One image to build within a deployment's single builder machine.
export type BuildTarget = {
  serviceKey: string,
  // Where to push the built image: the service's own Fly app repository.
  pushTarget: string,
  // Upload-root-relative Dockerfile to build from; null = Railpack auto-detection.
  dockerfilePath: string | null,
  // Where detection starts, relative to the upload root. The build CONTEXT is
  // always the whole upload — a monorepo service usually has to reach shared
  // code above its own directory — so this only narrows where the builder looks
  // for a build to infer, never what it can COPY.
  rootDirectory: string | null,
  // The tenant env THIS target's build gets to see (buildTimeEnv of its spec).
  // Per target rather than per build: one machine builds them all, but a value
  // belonging to one service must not end up inlined into another's image.
  buildEnv: Record<string, string>,
};

export type StartBuildOptions = {
  ns: string,
  // The deployment this build belongs to; also the id of its validated upload
  // object and of its persisted log.
  deploymentId: string,
  uploadId: string,
  // Built in this order, in ONE machine. The first failure aborts the rest: the
  // whole deployment fails, so there is no half-built cluster to salvage.
  targets: BuildTarget[],
};

// ONE env channel, Vercel-style: every declared env var goes to both the build and the
// runtime, secrets included. There is deliberately no build/runtime marker on the wire and
// no allowlist of which vars qualify — a framework that inlines values (NEXT_PUBLIC_*,
// VITE_*) has to see them while it compiles, and nothing in a ServiceSpec says which vars
// those are, so guessing would just be a different way to be wrong.
//
// `{ ref }` values are the one exception, and only because they are unresolvable rather
// than withheld: a ref names an output (url, hostname) of a service that has not been
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

// Per-deployment webhook token: HMAC over (deploymentId, ns) so a stolen token can't
// complete a different deployment, and Marshal can verify statelessly.
export function computeWebhookToken(deploymentId: string, ns: string): string {
  return createHmac("sha256", getConfig().webhookSecret).update(`${deploymentId}\0${ns}`).digest("hex");
}

export function verifyWebhookToken(token: string, deploymentId: string, ns: string): boolean {
  const expected = computeWebhookToken(deploymentId, ns);
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
# Marshal validates the archive and copies it to an immutable, deployment-specific object
# before this machine receives credentials. The original client-writable upload is never
# extracted.
wget -q -O /tmp/ctx.tar.gz "$TARBALL_URL" || fail "failed to fetch the source tarball"
tar xzf /tmp/ctx.tar.gz -C /ctx || fail "the source tarball is not a valid gzipped tarball"
cd /ctx
mkdir -p /root/.docker
printf '{"auths":{"%s":{"auth":"%s"}}}' "$REGISTRY_HOST" "$REGISTRY_AUTH_B64" > /root/.docker/config.json

# Tenant build-time env, one directory per TARGET and one file per var inside it (filename =
# var name, contents = the exact value). Per target because one machine builds every service
# of the deployment: a value belonging to one service must never be offered to another's
# build, where a framework that inlines values would bake it into the wrong image.
# Nothing here echoes a value; the helpers print only names and paths.
target_env_dir() { printf '%s/%s' "$BUILD_ENV_DIR" "$1"; }
# Deliberately unquoted at the call site: word-splitting IS the mechanism, and var names
# (and the fixed dir) contain no whitespace, so each printf below becomes exactly two words.
secret_args() {
  [ -d "$1" ] || return 0
  for f in "$1"/*; do
    [ -f "$f" ] || continue
    printf ' --secret id=%s,src=%s' "\${f##*/}" "$f"
  done
}
# Railpack's frontend keys its layer cache on this: without it, a changed secret would reuse
# the layer built from the old one. Every builder here is ephemeral so there is no cache to
# poison today, but the frontend's contract is what it is and the hash is nearly free.
secrets_hash() {
  [ -d "$1" ] || return 0
  for f in "$1"/*; do
    [ -f "$f" ] || continue
    printf '%s=' "\${f##*/}"; cat "$f"; printf '\\n'
  done | sha256sum | cut -d' ' -f1
}

# One line per target: <service_key>TAB<push_target>TAB<dockerfile_path>TAB<root_directory>.
# A tab-separated manifest rather than JSON because this is /bin/sh with no jq, and every
# field is already validated by Marshal to contain no tabs, newlines or control characters.
# Empty dockerfile_path selects Railpack auto-detection; empty root_directory means the
# upload root.
DIGESTS=""
# IFS is set from printf rather than written as "\\t": POSIX sh does NOT expand backslash
# escapes inside double quotes, so IFS="\\t" would split on backslash and the letter "t"
# instead of on tabs — quietly mangling every field of every target.
TAB="$(printf '\\t')"
while IFS="$TAB" read -r SERVICE_KEY PUSH_TARGET DOCKERFILE_PATH ROOT_DIRECTORY; do
  [ -n "$SERVICE_KEY" ] || continue
  echo "MARSHAL_TARGET_START $SERVICE_KEY"
  ENV_DIR="$(target_env_dir "$SERVICE_KEY")"
  # The build CONTEXT is always the whole upload, so a monorepo service can COPY shared code
  # from above its own directory. ROOT_DIRECTORY only says where a Dockerfile-less build
  # should look for something to infer.
  DETECT_DIR="/ctx"
  if [ -n "$ROOT_DIRECTORY" ]; then
    [ -d "/ctx/$ROOT_DIRECTORY" ] || fail "$SERVICE_KEY: rootDirectory $ROOT_DIRECTORY does not exist in the uploaded source"
    DETECT_DIR="/ctx/$ROOT_DIRECTORY"
  fi
  if [ -n "$DOCKERFILE_PATH" ]; then
    [ -f "/ctx/$DOCKERFILE_PATH" ] || fail "$SERVICE_KEY: no Dockerfile found at $DOCKERFILE_PATH in the uploaded source"
    set -- $(secret_args "$ENV_DIR")
    if [ -d "$ENV_DIR" ]; then
      for f in "$ENV_DIR"/*; do
        [ -f "$f" ] || continue
        # \\$(cat) drops trailing newlines — a build ARG is a command-line string, so a value
        # ending in one cannot survive this channel. The secret mount above is byte-exact.
        set -- "$@" --opt "build-arg:\${f##*/}=$(cat "$f")"
      done
    fi
    if ! buildctl build --frontend dockerfile.v0 --local context=/ctx --local dockerfile=/ctx \\
        --opt "filename=$DOCKERFILE_PATH" "$@" \\
        --output "type=image,name=$PUSH_TARGET,push=true" --metadata-file /tmp/md.json 2>&1; then
      fail "$SERVICE_KEY: docker build failed (see the build log above)"
    fi
  else
    echo "MARSHAL_RAILPACK_DETECT $SERVICE_KEY"
    if [ ! -f /tmp/railpack-bin/railpack ]; then
      wget -q -O /tmp/railpack.tar.gz "$RAILPACK_CLI_URL" || wget -q -O /tmp/railpack.tar.gz "$RAILPACK_CLI_URL" || fail "failed to fetch the railpack CLI (a build-infrastructure problem, not an issue with your code)"
      echo "$RAILPACK_CLI_SHA256  /tmp/railpack.tar.gz" | sha256sum -c - >/dev/null 2>&1 || fail "the railpack CLI download failed checksum verification (a build-infrastructure problem, not an issue with your code)"
      mkdir -p /tmp/railpack-bin
      tar xzf /tmp/railpack.tar.gz -C /tmp/railpack-bin || fail "failed to extract the railpack CLI (a build-infrastructure problem, not an issue with your code)"
      [ -x /tmp/railpack-bin/railpack ] || fail "the railpack CLI archive did not contain the expected binary (a build-infrastructure problem, not an issue with your code)"
    fi
    # The plan gets its own directory: it is transferred to the frontend as the whole
    # "dockerfile" local, which must not drag /tmp scratch files along. The CLI runs in a
    # subshell with the build credentials stripped — unlike Dockerfile RUN steps (sandboxed by
    # buildkit), it executes directly in this harness, and it has no business seeing them.
    rm -rf /tmp/railpack-plan && mkdir -p /tmp/railpack-plan
    # railpack sees the env twice, for two different reasons. Here, --env is what DETECTION
    # reads (a NODE_VERSION or a RAILPACK_* knob changes the plan it emits) and what makes it
    # list each name in the plan's "secrets"; the values themselves never enter the plan file.
    # Below, buildctl supplies those same names as secret mounts, which the railpack frontend
    # exposes as environment variables on every build step — that is the channel a "next
    # build" actually reads NEXT_PUBLIC_* from.
    set --
    if [ -d "$ENV_DIR" ]; then
      for f in "$ENV_DIR"/*; do
        [ -f "$f" ] || continue
        set -- "$@" --env "\${f##*/}=$(cat "$f")"
      done
    fi
    if ! ( unset REGISTRY_AUTH_B64 WEBHOOK_TOKEN WEBHOOK_URL TARBALL_URL; cd "$DETECT_DIR" && /tmp/railpack-bin/railpack prepare . --plan-out /tmp/railpack-plan/railpack-plan.json "$@" 2>&1 ); then
      fail "$SERVICE_KEY: railpack could not determine how to build this service (see the log above) — add a Dockerfile and set dockerfilePath in your deploy file, or configure detection with a railpack.json (https://railpack.com)"
    fi
    set -- $(secret_args "$ENV_DIR")
    if [ "$#" -gt 0 ]; then set -- "$@" --opt "build-arg:secrets-hash=$(secrets_hash "$ENV_DIR")"; fi
    if ! buildctl build --frontend gateway.v0 --opt "source=$RAILPACK_FRONTEND_IMAGE" \\
        --local context="$DETECT_DIR" --local dockerfile=/tmp/railpack-plan "$@" \\
        --output "type=image,name=$PUSH_TARGET,push=true" --metadata-file /tmp/md.json 2>&1; then
      fail "$SERVICE_KEY: railpack build failed (see the build log above)"
    fi
  fi
  DIGEST="$(sed -n 's/.*"containerimage.digest"[^"]*"\\([^"]*\\)".*/\\1/p' /tmp/md.json | head -n 1)"
  [ -n "$DIGEST" ] || fail "$SERVICE_KEY: the build produced no image digest"
  # Accumulated as JSON by hand: service keys and digests are both validated to be
  # alphanumeric-ish, so no escaping is needed and there is no jq in this image.
  if [ -n "$DIGESTS" ]; then DIGESTS="$DIGESTS,"; fi
  DIGESTS="$DIGESTS\\"$SERVICE_KEY\\":\\"$DIGEST\\""
  echo "MARSHAL_TARGET_DONE $SERVICE_KEY"
done < /marshal-targets.tsv
printf '{"targets":{%s}}' "$DIGESTS" > /tmp/result.json
webhook succeeded application/json /tmp/result.json
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

      const tarballUrl = await presignValidatedUploadGet(options.ns, options.deploymentId, BUILD_TIMEOUT_SECONDS + 60);
      const webhookToken = computeWebhookToken(options.deploymentId, options.ns);
      const webhookUrl = `${config.publicUrl}${buildCompletionPath(options.deploymentId)}?ns=${encodeURIComponent(options.ns)}`;

      // The tab-separated manifest the harness loops over. Every field has been
      // validated (service keys, image refs and paths contain no tabs, newlines
      // or control characters), which is what lets /bin/sh read it with `read`
      // instead of parsing JSON without jq.
      const targetsManifest = options.targets
        .map((target) => [target.serviceKey, target.pushTarget, target.dockerfilePath ?? "", target.rootDirectory ?? ""].join("\t"))
        .join("\n");
      // A Railpack build needs the bigger guest; one machine builds every target,
      // so ANY auto-detected target decides the size for the whole run.
      const isRailpackBuild = options.targets.some((target) => target.dockerfilePath === null);
      await lease.assertOwned();
      const machine = await fly.createMachine(builderApp, {
        name: `build-${options.deploymentId.toLowerCase()}`,
        region: config.fly.region,
        config: {
          image: BUILDER_IMAGE,
          guest: isRailpackBuild ? RAILPACK_BUILDER_GUEST : BUILDER_GUEST,
          // One microVM per DEPLOYMENT = tenant isolation; auto_destroy reclaims it on exit
          // (logs survive destruction — smoke-verified). Every service of one deployment
          // source shares it, which is the point: they share a source tree, and a machine
          // per service would re-fetch and re-extract it for each.
          auto_destroy: true,
          restart: { policy: "no" },
          init: { exec: ["/bin/sh", "/marshal-build.sh"] },
          files: [
            {
              guest_path: "/marshal-build.sh",
              raw_value: Buffer.from(buildHarnessScript()).toString("base64"),
            },
            {
              guest_path: "/marshal-targets.tsv",
              raw_value: Buffer.from(`${targetsManifest}\n`, "utf8").toString("base64"),
            },
            // Tenant env, one directory per TARGET and one file per var. NOT in the env
            // block below: that one holds Marshal's org token and registry auth, and a
            // tenant value sitting next to them is one careless `env` away from being
            // logged as a credential — and one careless credential away from being handed
            // to `railpack prepare`, which runs unsandboxed in the harness.
            // An EMPTY value is skipped: it would mean a files entry whose raw_value is the
            // empty string, which the API is free to read as "no content supplied" rather
            // than "supplied, and empty". There is nothing to inline either way, and the
            // runtime env still carries the var — so the ambiguity is simply not worth
            // entering. The harness's `[ -f "$f" ]` guard makes the absence a non-event.
            ...options.targets.flatMap((target) => Object.entries(target.buildEnv).flatMap(([key, value]) => value === "" ? [] : [{
              guest_path: `${BUILD_ENV_DIR}/${target.serviceKey}/${key}`,
              raw_value: Buffer.from(value, "utf8").toString("base64"),
            }])),
          ],
          metadata: { marshal_deployment_id: options.deploymentId },
          env: {
            // A path, not a value: the harness reads the values out of the files above.
            BUILD_ENV_DIR,
            TARBALL_URL: tarballUrl,
            REGISTRY_HOST: config.fly.registryHost,
            REGISTRY_AUTH_B64: fly.registryAuthBase64(),
            WEBHOOK_URL: webhookUrl,
            WEBHOOK_TOKEN: webhookToken,
            BUILD_TIMEOUT_SECONDS: String(BUILD_TIMEOUT_SECONDS),
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
  deploymentId: string,
  status: "succeeded" | "failed",
  // On success: the JSON the harness posts, `{"targets":{"<service_key>":"sha256:..."}}`.
  metadataJson: string | null,
  errorText: string | null,
}) => Promise<void>;

export function createMockBuilder(completeBuild: CompleteBuildFn): Builder {
  return {
    name: "mock",
    async startBuild(options, lease) {
      await lease.assertOwned();
      // Test hook: a target whose build env declares MARSHAL_MOCK_FAIL_BUILD fails the
      // whole build — the only way e2e can exercise the failure path with an instant fake
      // builder, and it fails the whole deployment exactly as a real build would.
      const shouldFail = options.targets.some((target) => Object.hasOwn(target.buildEnv, "MARSHAL_MOCK_FAIL_BUILD"));
      // Deterministic fake digests so e2e assertions and image mapping are stable. Derived
      // per target from the deployment id, since one build now produces several images.
      // Hashed rather than assembled from the ids themselves: a digest must be 64 HEX
      // characters to survive parseBuildImages, and a service key is free to contain
      // letters that hex does not have.
      const digests = Object.fromEntries(options.targets.map((target) => [
        target.serviceKey,
        `sha256:${createHash("sha256").update(`${options.deploymentId}-${target.serviceKey}`).digest("hex")}`,
      ]));
      // Complete on the next tick, mirroring the real flow's asynchrony without making the
      // request wait on the rollout.
      setTimeout(() => {
        // eslint-disable-next-line @typescript-eslint/no-floating-promises -- errors are handled inside
        (async () => {
          try {
            await completeBuild({
              ns: options.ns,
              deploymentId: options.deploymentId,
              status: shouldFail ? "failed" : "succeeded",
              metadataJson: shouldFail ? null : JSON.stringify({ targets: digests }),
              errorText: shouldFail ? "mock build failed (a target declares MARSHAL_MOCK_FAIL_BUILD)" : null,
            });
          } catch (error) {
            console.error(`mock builder: completing deployment ${options.deploymentId} failed`, error);
          }
        })();
      }, 0);
      return { builderApp: null, builderMachineId: null };
    },
  };
}
