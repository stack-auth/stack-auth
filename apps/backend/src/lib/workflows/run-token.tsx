import { globalPrismaClient } from "@/prisma-client";
import { KnownErrors } from "@hexclave/shared";
import { throwErr } from "@hexclave/shared/dist/utils/errors";
import { signJWT, verifyJWT } from "@hexclave/shared/dist/utils/jwt";
import { Result } from "@hexclave/shared/dist/utils/results";
import * as jose from "jose";
import { JOSEError } from "jose/errors";

// The bearer credential a workflow run uses to call back into the public API
// as project admin (`hexclaveApp.getUser(...)` and friends).
//
// This is a signed, self-describing token rather than a row in `ApiKeySet`.
// Earlier revisions minted a real API key set per claim, which had three
// problems: the rows surfaced in the customer-facing Project Keys list (where
// they could also be revoked, breaking a live run), each claim cost a write
// plus a retention sweep, and revoking on cancellation needed a `FOR UPDATE`
// dance to close the mint-vs-cancel race. A token removes all three: nothing
// is persisted, so nothing can leak into a CRUD or need cleaning up, and
// revocation falls out of the run's own state (see below).
//
// SECURITY MODEL — the token grants FULL PROJECT ADMIN, so every one of these
// properties is load-bearing:
//   * Signed with the per-audience key derived from HEXCLAVE_SERVER_SECRET, on
//     a `workflow-run:<projectId>` audience. Because `getPrivateJwks` derives
//     the key from the audience, a token minted for one project is not merely
//     rejected by a check — it is signed with a different key than any other
//     project's, and than any user access token.
//     The audience puts the constant FIRST on purpose: `decodeAccessToken`
//     parses an access-token audience positionally as `aud.split(":")[0]`, so
//     a `<projectId>:workflow-run` audience would yield a real project id
//     there and leave `iss` as the only thing separating a project-admin
//     credential from an end-user one. With the constant first, that parse
//     produces a non-existent project and the replay fails for two
//     independent reasons instead of one.
//   * Bound to (project, branch, tenancy, run, workflow, leaseToken). The
//     lease token is rotated on every claim (`claimDueRuns` is the only writer
//     of that column), so a sandbox whose run has been re-claimed by another
//     worker is locked out even though the run is still RUNNING.
//   * Checked against live run state on every request, which is what makes
//     cancellation take effect immediately: a canceled run is no longer
//     RUNNING, so its in-flight sandbox stops being able to act.
//   * Short-lived regardless (WORKFLOW_RUN_TOKEN_TTL_MS in engine.tsx), so a
//     leaked token dies on its own even if the run never terminates.
//
// KNOWN CONSEQUENCE: work the engine has already abandoned loses API access
// mid-flight rather than being allowed to finish. When a step exceeds its
// timeout, or the engine-side backstop fires, the run leaves RUNNING while the
// sandbox may still be executing; further `hexclaveApp` calls from that
// abandoned closure now fail authentication. That is the intended semantics
// (the engine discards those results anyway), but it means user code can
// observe an auth error from its own credential after a timeout.
//
// SHARDING: this read runs against the global Prisma client, and workflow
// tables live in that database today — see the sharding note in events.tsx.
// Note the blast radius is wider here than there: if those tables become
// unreachable, this is a branch of the generic auth path taken by every API
// request, not just workflow machinery.

/**
 * Distinguishes a run token from a real API key in the credential header.
 * Real keys are `pck_`/`ssk_`/`sak_` followed by base32 (see
 * `createApiKeySet`), so `wrt_` is unreachable by construction rather than
 * merely improbable.
 */
export const WORKFLOW_RUN_TOKEN_PREFIX = "wrt_";

// Internal-only: unlike access tokens, nothing outside this backend ever
// verifies a run token, so the issuer does not need to encode a host (and
// deliberately does not — that avoids the cloud-host-alias problem that
// access tokens have to carry).
const WORKFLOW_RUN_TOKEN_ISSUER = "hexclave-workflow-engine";
const WORKFLOW_RUN_TOKEN_TYPE = "workflow_run";

function getWorkflowRunTokenAudience(projectId: string): string {
  return `workflow-run:${projectId}`;
}

export type WorkflowRunTokenClaims = {
  tenancyId: string,
  branchId: string,
  runId: string,
  workflowId: string,
  /** The claim's fencing token; must still match the run's current lease. */
  leaseToken: string,
};

/**
 * Why a token was rejected. Kept as a closed union so the auth path can log
 * the specific reason while returning a single generic error to the caller —
 * these strings must never reach an API response.
 */
export type WorkflowRunTokenRejection =
  | "not-a-run-token"
  | "unparsable"
  | "audience-mismatch"
  | "signature-or-expiry-invalid"
  | "issuer-mismatch"
  | "wrong-token-type"
  | "malformed-claims"
  | "tenancy-not-found"
  | "branch-mismatch"
  | "tenancy-mismatch"
  | "run-not-found"
  | "run-not-running"
  | "workflow-mismatch"
  | "lease-superseded";

export async function createWorkflowRunToken(options: WorkflowRunTokenClaims & {
  projectId: string,
  expiresInMs: number,
}): Promise<string> {
  // A non-positive or non-finite TTL would mint a token that is already dead
  // (or make jose throw deep inside signing); neither should ever be reachable
  // from the engine's constant, so fail loudly rather than produce one.
  if (!Number.isFinite(options.expiresInMs) || options.expiresInMs < 1000) {
    throwErr("Workflow run token TTL must be a finite duration of at least one second", { expiresInMs: options.expiresInMs });
  }
  const jwt = await signJWT({
    issuer: WORKFLOW_RUN_TOKEN_ISSUER,
    audience: getWorkflowRunTokenAudience(options.projectId),
    expirationTime: `${Math.floor(options.expiresInMs / 1000)}s`,
    payload: {
      token_type: WORKFLOW_RUN_TOKEN_TYPE,
      sub: options.runId,
      tenancy_id: options.tenancyId,
      branch_id: options.branchId,
      workflow_id: options.workflowId,
      lease_token: options.leaseToken,
    },
  });
  return WORKFLOW_RUN_TOKEN_PREFIX + jwt;
}

/** Cheap syntactic check so the auth path can route a credential header without doing crypto. */
export function isWorkflowRunToken(value: string | null | undefined): value is string {
  return typeof value === "string" && value.startsWith(WORKFLOW_RUN_TOKEN_PREFIX);
}

/**
 * Verifies signature, expiry, issuer, audience and claim shape. Does NOT
 * consult the database, so on its own it is NOT sufficient to authenticate a
 * request — {@link authenticateWorkflowRunToken} is the entry point. Exported
 * separately so the cryptographic half can be unit-tested without a DB.
 */
export async function verifyWorkflowRunTokenClaims(token: string, options: {
  projectId: string,
}): Promise<Result<WorkflowRunTokenClaims, WorkflowRunTokenRejection>> {
  if (!isWorkflowRunToken(token)) return Result.error("not-a-run-token");
  const jwt = token.slice(WORKFLOW_RUN_TOKEN_PREFIX.length);
  const expectedAudience = getWorkflowRunTokenAudience(options.projectId);

  // `verifyJWT` picks its key set from the token's OWN `aud` claim, so the
  // audience must be pinned to the project in the request BEFORE verifying.
  // Skipping this would let an attacker-supplied `aud` choose which key the
  // signature is checked against, which is the whole ballgame.
  let unverified: jose.JWTPayload;
  try {
    unverified = jose.decodeJwt(jwt);
  } catch (error) {
    if (error instanceof JOSEError) return Result.error("unparsable");
    throw error;
  }
  // Strict equality also rejects an `aud` supplied as an array, which is legal
  // JWT but which `verifyJWT` cannot handle either.
  if (unverified.aud !== expectedAudience) return Result.error("audience-mismatch");

  let payload: jose.JWTPayload;
  try {
    payload = await verifyJWT({ allowedIssuers: [WORKFLOW_RUN_TOKEN_ISSUER], jwt });
  } catch (error) {
    // Only JOSE-level failures are authentication failures (bad signature,
    // expired, disallowed issuer). Anything else — notably the assertion
    // `getPrivateJwks` throws when HEXCLAVE_SERVER_SECRET is missing or
    // malformed — is a server fault and must surface loudly instead of being
    // laundered into "invalid credential" for every workflow in the fleet.
    if (error instanceof JOSEError) return Result.error("signature-or-expiry-invalid");
    throw error;
  }

  // Re-assert against the VERIFIED payload rather than trusting the earlier
  // read of the unverified one.
  if (payload.aud !== expectedAudience) return Result.error("audience-mismatch");
  if (payload.iss !== WORKFLOW_RUN_TOKEN_ISSUER) return Result.error("issuer-mismatch");
  if (payload.token_type !== WORKFLOW_RUN_TOKEN_TYPE) return Result.error("wrong-token-type");

  // Checked field by field (rather than by iterating an assembled object) so
  // that adding an optional claim later cannot silently make it required, and
  // so the result narrows without a cast.
  const { sub, tenancy_id: tenancyId, branch_id: branchId, workflow_id: workflowId, lease_token: leaseToken } = payload;
  const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.length > 0;
  if (!isNonEmptyString(sub)) return Result.error("malformed-claims");
  if (!isNonEmptyString(tenancyId)) return Result.error("malformed-claims");
  if (!isNonEmptyString(branchId)) return Result.error("malformed-claims");
  if (!isNonEmptyString(workflowId)) return Result.error("malformed-claims");
  if (!isNonEmptyString(leaseToken)) return Result.error("malformed-claims");

  return Result.ok({ runId: sub, tenancyId, branchId, workflowId, leaseToken });
}

/**
 * Full authentication: cryptographic verification plus the live-state check
 * that gives cancellation its teeth. This is the only function the auth path
 * should call.
 *
 * `tenancyId` is the tenancy the request already resolved from
 * (projectId, branchId). Comparing it to the token's own claim is what closes
 * the project-binding loop without an extra query.
 */
export async function authenticateWorkflowRunToken(options: {
  token: string,
  projectId: string,
  branchId: string,
  tenancyId: string,
}): Promise<Result<WorkflowRunTokenClaims, WorkflowRunTokenRejection>> {
  const verified = await verifyWorkflowRunTokenClaims(options.token, { projectId: options.projectId });
  if (verified.status === "error") return verified;
  const claims = verified.data;

  if (claims.branchId !== options.branchId) return Result.error("branch-mismatch");
  if (claims.tenancyId !== options.tenancyId) return Result.error("tenancy-mismatch");

  // Deliberately NOT $replica(): the claim that minted this token is a write
  // this read must observe. Replica lag would reject a run that was
  // legitimately claimed moments ago.
  const run = await globalPrismaClient.workflowRun.findUnique({
    where: { tenancyId_id: { tenancyId: claims.tenancyId, id: claims.runId } },
    select: { state: true, leaseToken: true, workflowId: true },
  });
  if (run == null) return Result.error("run-not-found");
  // Any non-RUNNING state means this sandbox no longer speaks for the run:
  // canceled, failed, completed, put to sleep, or handed back to the queue
  // after the engine-side invocation timeout fired.
  if (run.state !== "RUNNING") return Result.error("run-not-running");
  // Not used for authorization — (tenancy, run, lease) already determine the
  // run — but a signed claim that is never checked is a claim that can drift,
  // so it is asserted rather than carried decoratively.
  if (run.workflowId !== claims.workflowId) return Result.error("workflow-mismatch");
  // Both sides originate from Postgres `uuid` columns, which normalize to
  // lowercase canonical form, so a plain string comparison is exact.
  if (run.leaseToken == null || run.leaseToken !== claims.leaseToken) return Result.error("lease-superseded");

  return Result.ok(claims);
}

export type WorkflowRunTokenRequestCredential = {
  token: string,
  /** Which credential header carried the token — determines which KnownError a rejection maps to. */
  fromAdminHeader: boolean,
};

/**
 * Routes the two project-credential headers: returns the run token if either
 * carries one, else null. The run token deliberately rides in the ordinary
 * key headers (see the module comment) instead of a dedicated header, so the
 * auth path needs this to tell a `wrt_` credential apart from a real key.
 *
 * Resolved per header rather than short-circuiting on the first: if both hold
 * run tokens the admin header wins (it is the slot the runtime shim actually
 * uses), and callers should still use {@link isWorkflowRunToken} per header to
 * suppress the ApiKeySet lookup ONLY for the header that holds a token — a
 * run token in one header must not reject a genuine key in the other.
 */
export function getWorkflowRunTokenFromHeaders(headers: { secretServerKey: string | null, superSecretAdminKey: string | null }): WorkflowRunTokenRequestCredential | null {
  if (isWorkflowRunToken(headers.superSecretAdminKey)) return { token: headers.superSecretAdminKey, fromAdminHeader: true };
  if (isWorkflowRunToken(headers.secretServerKey)) return { token: headers.secretServerKey, fromAdminHeader: false };
  return null;
}

/**
 * Rejections reachable by any unauthenticated caller who knows a project id
 * (which is semi-public): purely syntactic failures, forged/expired
 * signatures, and a (projectId, branchId) that resolves to no tenancy — none
 * of which prove the caller ever held a real token. These are not logged,
 * because logging them would hand out a free log-spam primitive and tell us
 * nothing actionable. Everything else got past signature verification, i.e.
 * a GENUINE engine-minted token was rejected — that is always worth a log
 * line (a canceled run's sandbox still calling out, a superseded lease, a
 * drifted claim).
 */
const UNAUTHENTICATED_REACHABLE_REJECTIONS: readonly WorkflowRunTokenRejection[] = ["not-a-run-token", "unparsable", "audience-mismatch", "signature-or-expiry-invalid", "tenancy-not-found"];

/**
 * The auth-path entry point: fully authenticates a run-token credential
 * (crypto + live run state) and, on rejection, throws the SAME KnownError an
 * invalid real key in that header would produce — the specific rejection
 * reason must never reach the caller, since it would disclose run ids, run
 * state, and lease details to unauthenticated probing.
 */
export async function authenticateWorkflowRunTokenRequestOrThrow(options: {
  credential: WorkflowRunTokenRequestCredential,
  projectId: string,
  branchId: string,
  /**
   * Null when (projectId, branchId) resolved to no tenancy. Treated as an
   * authentication failure rather than a branch-not-found error so an
   * unauthenticated caller cannot use this path to probe which branches
   * exist.
   */
  tenancyId: string | null,
}): Promise<WorkflowRunTokenClaims> {
  const authResult = options.tenancyId == null
    ? Result.error("tenancy-not-found" as const)
    : await authenticateWorkflowRunToken({
      token: options.credential.token,
      projectId: options.projectId,
      branchId: options.branchId,
      tenancyId: options.tenancyId,
    });
  if (authResult.status === "error") {
    if (!UNAUTHENTICATED_REACHABLE_REJECTIONS.includes(authResult.error)) {
      console.log(`[Workflow run token] Rejected an authentic run token for project ${options.projectId}: ${authResult.error}`);
    }
    throw options.credential.fromAdminHeader
      ? new KnownErrors.InvalidSuperSecretAdminKey(options.projectId)
      : new KnownErrors.InvalidSecretServerKey(options.projectId);
  }
  return authResult.data;
}
