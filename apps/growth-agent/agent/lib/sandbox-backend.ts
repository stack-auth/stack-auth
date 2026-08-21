import type { SandboxBackend } from "eve/sandbox";
import { docker, type DockerSandboxCreateOptions } from "eve/sandbox/docker";
import { vercel, type VercelSandboxCreateOptions } from "eve/sandbox/vercel";

/**
 * Chooses which runtime hosts every growth sandbox — the root agent's and all three subagents'.
 *
 * WHY THIS EXISTS INSTEAD OF `defaultBackend()`. eve's `defaultBackend()` picks a backend by
 * probing the host, and its first probe is `!!process.env.VERCEL`. That is an implicit decision
 * made by whatever happens to be in the environment, and it went wrong in exactly the way you would
 * expect: the runtime choice otherwise changes with the host, which makes local behavior depend on
 * whether a Vercel environment marker happens to be present. The explicit environment override keeps
 * that choice deliberate; local development is currently pinned to Vercel in apps/growth-agent/.env.
 *
 * `docker()` and `vercel()` pin their backend unconditionally (eve's own docs: "Configuring this
 * backend pins it unconditionally — when you want fallback behavior, use `defaultBackend()`"), so
 * routing through this one function makes the choice explicit, greppable, and identical across all
 * four sandboxes.
 *
 * NOTE ON THE OTHER TWO BACKENDS. eve also ships `microsandbox()` and `justbash()`. They are
 * deliberately not reachable here: `justbash()` runs commands with no isolation at all, which would
 * silently void the egress boundaries these sandboxes exist to enforce, and `microsandbox()` only
 * works on some hosts. Neither belongs behind an env var that a deployment could set by accident.
 */

/** Env var that pins the backend. Unset means "decide from the deployment environment" (below). */
const SANDBOX_BACKEND_ENV_VAR = "HEXCLAVE_GROWTH_SANDBOX_BACKEND";

const SANDBOX_BACKEND_IDS = ["docker", "vercel"] as const;
type SandboxBackendId = typeof SANDBOX_BACKEND_IDS[number];

/**
 * The per-backend option bags, mirroring `defaultBackend()`'s shape so call sites read the same as
 * before. Both are REQUIRED: a sandbox that omits one would get that backend's defaults, and for
 * `vercel` the default is "no network policy", i.e. the loosest possible egress. Making an author
 * write both means the network posture of every sandbox is visible in its own file.
 */
export type GrowthSandboxBackendOptions = {
  readonly docker: DockerSandboxCreateOptions,
  readonly vercel: VercelSandboxCreateOptions,
};

function parseBackendId(value: string): SandboxBackendId {
  // A local widening `.includes` on the const tuple rather than a cast: `readonly ["docker", ...]`
  // does not accept an arbitrary string, and `as SandboxBackendId` would let a typo through as a
  // real backend id.
  const ids: readonly string[] = SANDBOX_BACKEND_IDS;
  if (!ids.includes(value)) {
    throw new Error(
      `${SANDBOX_BACKEND_ENV_VAR} must be one of ${SANDBOX_BACKEND_IDS.join(", ")}, got ${JSON.stringify(value)}. `
      + `Fail loudly rather than guessing: picking the wrong one either bills a hosted sandbox for every local run or `
      + `breaks a deployment that cannot run containers.`,
    );
  }
  return SANDBOX_BACKEND_IDS.find((id) => id === value) ?? throwUnreachable(value);
}

function throwUnreachable(value: string): never {
  throw new Error(`Unreachable: ${JSON.stringify(value)} passed the ${SANDBOX_BACKEND_ENV_VAR} allow-list check but matched no id`);
}

/**
 * Resolves the backend for one sandbox.
 *
 * Precedence:
 *  1. `HEXCLAVE_GROWTH_SANDBOX_BACKEND` when set — the explicit choice, and what local dev uses (see
 *     `apps/growth-agent/.env`). An unrecognised value throws rather than falling back, because
 *     both wrong answers are expensive in opposite directions.
 *  2. Otherwise `vercel` when `process.env.VERCEL` is set, because a Vercel deployment genuinely
 *     cannot run a local container runtime, and `docker` everywhere else.
 *
 * Read per call rather than cached at module scope, so a deployment can change the backend without
 * a rebuild — and so tests can vary it.
 */
export function growthSandboxBackend(options: GrowthSandboxBackendOptions): SandboxBackend {
  const override = process.env[SANDBOX_BACKEND_ENV_VAR];
  const backendId: SandboxBackendId = override != null && override.length > 0
    ? parseBackendId(override)
    : (process.env.VERCEL != null && process.env.VERCEL.length > 0 ? "vercel" : "docker");

  switch (backendId) {
    case "docker": {
      return docker(options.docker);
    }
    case "vercel": {
      // `vercel()` is typed with its own bootstrap/session option generics. None of the growth
      // sandboxes use `bootstrap({ use })` or `onSession({ use })`, so the narrower default
      // generics on the return type are accurate for every caller here.
      return vercel(options.vercel);
    }
  }
}
