import type { SessionAuth, SessionAuthContext } from "eve/context";

/**
 * How per-run context (project/branch/run ids) reaches the root agent's tools
 * without ever passing through the model:
 *
 * The channel dispatch code starts every eve session via `send(..., { auth })`
 * and encodes the run context into `SessionAuthContext.attributes`. eve
 * persists that auth on the session and exposes it to every tool call as
 * `ctx.session.auth`, so a static tool under `agent/tools/` can recover the
 * exact project/branch/run it is operating on. This was chosen over the two
 * alternatives eve@0.27.0 offers:
 *
 * - LLM-provided ids (what the declared subagents' tools use, since a declared
 *   subagent only receives context through its task message): fine for
 *   subagents, but for root tools we can do better — a model can mistype or
 *   mix up ids, and auth attributes cannot be tampered with by the model.
 * - Channel `state` + `metadata()` + `defineDynamic` tool resolvers: works,
 *   but forces every tool to be dynamic and couples them to the channel's
 *   metadata projection; auth attributes are the lighter, purpose-built
 *   carrier for caller identity ("which tenant/run is this session for").
 *
 * Note that root-built-in `agent` copies inherit the parent's auth, and
 * declared subagents receive it as `session.auth.initiator`, so the context
 * survives delegation — though the declared subagents built today take ids
 * from their task message instead.
 */

export const GROWTH_SESSION_AUTHENTICATOR = "hexclave-growth-dispatch";

/**
 * The minimum a context object has to expose for the readers in this file.
 *
 * Deliberately structural rather than eve's `ToolContext` / `SessionContext`: those are the two
 * shapes that reach these functions today (a tool's `execute` and a connection's `auth`/`approval`
 * callbacks), they both satisfy this, and naming only the part that is actually read means (a) a
 * third eve context shape works without a signature change, and (b) these functions can be tested
 * against a plain object instead of a cast-constructed fake of a 10-member interface.
 */
export type GrowthAuthCarrierContext = {
  readonly session: {
    readonly auth: SessionAuth,
  },
};

/** Context describing what a growth session is working on. */
export type GrowthRunContext = {
  readonly project_id: string,
  readonly branch_id: string,
  /** The `source` stamped onto findings/artifacts saved by this session (usually the phase key). */
  readonly finding_source: string,
  /** Present only for analysis-phase sessions. */
  readonly run_id?: string,
  /**
   * The analysis phase key for analysis-phase sessions, or one of the sentinel keys for the
   * non-analysis session kinds ({@link GROWTH_INTERVIEW_PHASE_KEY}, {@link GROWTH_CHAT_PHASE_KEY}).
   * Absent for daily-brief sessions.
   */
  readonly phase_key?: string,
  /** Present only for daily-brief sessions (YYYY-MM-DD, UTC). */
  readonly brief_date?: string,
};

const OPTIONAL_ATTRIBUTE_KEYS = ["run_id", "phase_key", "brief_date"] as const;

/**
 * Input to {@link buildGrowthSessionAuth}: the run identity plus the session's bearer token.
 *
 * Deliberately a superset of {@link GrowthRunContext} rather than an extension of it.
 * `readGrowthRunContext` answers "which project/branch/run is this session for" and is what the
 * root tools consume; nothing in that answer should grow a bearer token. Keeping the two types
 * separate means a tool cannot accidentally read `agent_token` off a run context.
 */
export type GrowthSessionAuthInput = GrowthRunContext & {
  /**
   * The run-scoped `grt_` token the backend minted for this dispatch, forwarded verbatim from the
   * dispatch body. Optional because the backend chunk that starts sending it may deploy after this
   * agent: an absent token must degrade gracefully, never to a crash and never to a session that
   * silently uses some other credential.
   */
  readonly agent_token?: string,
};

/** Builds the `auth` value passed to the channel's `send()` for a growth session. */
export function buildGrowthSessionAuth(context: GrowthSessionAuthInput): SessionAuthContext {
  return {
    authenticator: GROWTH_SESSION_AUTHENTICATOR,
    principalType: "service",
    principalId: `${context.project_id}:${context.branch_id}`,
    attributes: {
      project_id: context.project_id,
      branch_id: context.branch_id,
      finding_source: context.finding_source,
      ...context.agent_token === undefined ? {} : { agent_token: context.agent_token },
      ...Object.fromEntries(OPTIONAL_ATTRIBUTE_KEYS.flatMap((key) => {
        const value = context[key];
        return value === undefined ? [] : [[key, value]];
      })),
    },
  };
}

// `Partial` because the tsconfig has noUncheckedIndexedAccess off: without it
// the index access below would be typed as always-present even though the
// attribute may be missing. SessionAuthContext's attributes assign to this.
function readAttribute(attributes: Readonly<Partial<Record<string, string | readonly string[]>>>, key: string): string | undefined {
  const value = attributes[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new Error(`Growth session auth attribute "${key}" is not a string — the session was not started by the growth dispatch code`);
  }
  return value;
}

/**
 * Recovers the growth run context inside a tool's `execute`. Throws when the
 * session was not started by the growth dispatch code (e.g. someone wiring
 * these tools into a differently-authenticated channel), because operating on
 * an unknown project would be far worse than failing the tool call.
 *
 * Every tool under `agent/tools/` calls this (directly or through
 * `readGrowthRunContextWithRunId` / `readGrowthInterviewContext`) as the first thing it does,
 * because it is where each tool learns which project it operates on. That makes this the natural
 * choke point for keeping a narrow session kind off the root tool surface: a kind that must not see
 * these tools is rejected here by its `phase_key`, which is default-deny over the whole surface
 * rather than a list of blocked tool names, so a tool added later inherits it for free. The
 * ads-execution session — whose job is creating billable objects and which therefore must run on the
 * smallest possible surface — is exactly such a kind, and reinstates that check here when the ad
 * platform integration lands.
 */
export function readGrowthRunContext(ctx: GrowthAuthCarrierContext): GrowthRunContext {
  return parseGrowthRunContext(ctx);
}

function parseGrowthRunContext(ctx: GrowthAuthCarrierContext): GrowthRunContext {
  // `current` is the auth of the request that started/last delivered to this
  // session; `initiator` covers delegated child sessions (root `agent` copies)
  // where the current hop may not carry the original dispatch auth.
  const auth = ctx.session.auth.current ?? ctx.session.auth.initiator;
  if (auth == null || auth.authenticator !== GROWTH_SESSION_AUTHENTICATOR) {
    throw new Error("This session carries no growth run context; growth tools can only run in sessions started by the growth dispatch channel");
  }
  const attributes = auth.attributes;
  const requireAttribute = (key: string): string => {
    const value = readAttribute(attributes, key);
    if (value == null || value.length === 0) {
      throw new Error(`Growth session auth attribute "${key}" is missing — the session was not started by the growth dispatch code`);
    }
    return value;
  };
  return {
    project_id: requireAttribute("project_id"),
    branch_id: requireAttribute("branch_id"),
    finding_source: requireAttribute("finding_source"),
    run_id: readAttribute(attributes, "run_id"),
    phase_key: readAttribute(attributes, "phase_key"),
    brief_date: readAttribute(attributes, "brief_date"),
  };
}

/**
 * Sentinel `phase_key` for live customer-interview sessions. Interview turns
 * are not analysis phases (no attempt/lifecycle), but they reuse the same
 * context carrier; the sentinel is what lets interview-only tools reject calls
 * from analysis/brief/chat sessions. "interview" can never collide with a real
 * phase key: those are the fixed keys plus the `analysis:` namespace (see the
 * backend's lib/growth/phases.ts).
 */
export const GROWTH_INTERVIEW_PHASE_KEY = "interview";

/**
 * Sentinel `phase_key` for freeform growth chat sessions (the /chat channel route). Like the
 * interview sentinel it can never collide with a real phase key. Chat sessions carry it WITHOUT a
 * run_id, which is what keeps the interview-only tools locked out of chat (their guard requires
 * run_id + the interview sentinel) while the run-agnostic tools (sql-query, get-metrics,
 * save-finding, create-action-item, ...) keep working — they only need
 * project/branch/finding_source. Tools that must reject chat sessions in the future should check
 * `phase_key === GROWTH_CHAT_PHASE_KEY` explicitly rather than relying on run_id absence (daily
 * briefs also have no run_id).
 */
export const GROWTH_CHAT_PHASE_KEY = "chat";

/**
 * Like {@link readGrowthRunContextWithRunId} but additionally asserts the
 * session is a live customer-interview turn. Used by the interview-only tools
 * (present-interview-question, record-adaptive-question, complete-interview),
 * which live on the root tool surface and would otherwise be callable from
 * analysis-phase sessions. The error message is model-facing.
 */
export function readGrowthInterviewContext(ctx: GrowthAuthCarrierContext): GrowthRunContext & { readonly run_id: string } {
  const context = readGrowthRunContextWithRunId(ctx);
  if (context.phase_key !== GROWTH_INTERVIEW_PHASE_KEY) {
    throw new Error("This tool is only available during a live founder interview session; do not call it from analysis phases, daily briefs, or chat");
  }
  return context;
}

/**
 * Like {@link readGrowthRunContext} but asserts the session belongs to an
 * analysis run, for tools that only make sense inside one (interview
 * questions, reports). The error message is model-facing: it tells the model
 * why the call is invalid rather than hinting at infrastructure details.
 */
export function readGrowthRunContextWithRunId(ctx: GrowthAuthCarrierContext): GrowthRunContext & { readonly run_id: string } {
  const context = readGrowthRunContext(ctx);
  const runId = context.run_id;
  if (runId == null) {
    throw new Error("This tool is only available during an analysis run, and the current session is not part of one (it is a daily brief or chat session)");
  }
  return { ...context, run_id: runId };
}
