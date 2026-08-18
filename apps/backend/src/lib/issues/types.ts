import type { GroupingConfigId } from "./grouping-config";

/**
 * Which stack-trace dialect a raw `data.stack` string is written in.
 *
 * This is NOT the same as "which runtime produced the error": Node, Bun and
 * Deno all emit V8-shaped stacks, and every browser emits either a V8-shaped or
 * a Gecko-shaped one. What actually differs between the two values here is the
 * `in_app` ruleset (see `in-app.ts`) and whether absolute filesystem paths are
 * expected, which is why the split is by *environment* rather than by browser.
 */
export type StackPlatform = "javascript" | "node";

/**
 * One frame of a parsed stack trace.
 *
 * Frames are stored oldest-first (the crash site is the LAST element), matching
 * the order every error-tracking UI renders them in bottom-up.
 */
export type ParsedFrame = {
  /**
   * The display path. For URLs this is the pathname only (no origin), so the
   * same deploy on `localhost` and on production renders identically; for
   * filesystem paths it is the path as parsed.
   */
  filename: string | null,
  /** The function name exactly as it appeared in the stack, or null when the frame was anonymous. */
  function: string | null,
  /**
   * A bundler-independent logical module name derived from the path with
   * content hashes stripped (e.g. `static/chunks/4711-a1b2c3d4.js` -> `static/chunks/4711`).
   * This is what makes grouping survive a rebuild; see `deriveModule` in `stack-parser.ts`.
   */
  module: string | null,
  /** The raw, unmodified path/URL as it appeared in the stack. Never used for grouping directly. */
  absPath: string | null,
  lineno: number | null,
  colno: number | null,
  inApp: boolean,
  /** Debug id of the emitting artifact, when the SDK shipped a debug-image map. */
  debugId?: string,
  /**
   * Filled by symbolication. One optional sub-object, so the frame renderer
   * branches on presence exactly once.
   */
  context?: { line: string, pre: string[], post: string[], symbolicated: true },
};

/**
 * Everything grouping is allowed to look at. Deliberately a flat projection of
 * the `$error` event payload rather than the payload itself, so that adding a
 * field to the wire format cannot accidentally change any hash.
 */
export type GroupingInput = {
  /** The exception type, i.e. `data.name` ("TypeError", "NS_ERROR_FAILURE", ...). Hashed as a leaf. */
  type: string,
  /** The exception message, i.e. `data.message`. The default algorithm only hashes it without frames; `{{ message }}` opts in explicitly. */
  message: string,
  /** The raw stack string as shipped by the SDK, or null when the throw was stackless. */
  stack: string | null,
  platform: StackPlatform,
  /**
   * Sentry-compatible fingerprint values after wire normalization. The flat
   * SDK event calls this `fingerprint_override`; the richer envelope calls it
   * `fingerprint`. The local flat-event `fingerprint` string is deliberately
   * not projected here because it is only an SDK deduplication key.
   */
  fingerprint?: readonly string[],
  /**
   * `data.synthetic` — set when the thrown value was not an `Error`. Such
   * throws all carry `name: "Error"` and a capture-site stack, so they need
   * their own rule or they all collapse into one issue.
   */
  synthetic?: boolean,
};

export type GroupingFingerprintType = "default" | "custom" | "hybrid";

export type GroupingFingerprintSource = "default" | "event" | "degraded";

/**
 * What the server used for the fingerprint portion of a grouping decision.
 *
 * `tokens` preserves the normalized event contract for explainability. The
 * resolved values are included because a token such as `{{ message }}` is not
 * useful to an operator without seeing the parameterized value that was hashed.
 * Neither list participates in the hash as metadata; the hash is derived from
 * the same resolved values in `grouping.ts`.
 */
export type GroupingFingerprintProvenance = {
  type: GroupingFingerprintType,
  source: GroupingFingerprintSource,
  tokens: readonly string[],
  resolvedTokens: readonly string[],
};

export type GroupingProvenance = {
  configId: GroupingConfigId,
  fingerprint: GroupingFingerprintProvenance,
};

/**
 * The role of one hash in an event's grouping decision. Sentry keeps the
 * primary hash and transition/secondary hashes ordered and distinct; retaining
 * that distinction lets issue storage explain why a hash was considered without
 * pretending that an alias is an occurrence owner.
 */
export type GroupingHashRole = "primary" | "secondary";

/**
 * Explainable metadata for one hash produced by the grouping decision.
 * `hash` is included so this record can be stored as a self-contained JSON
 * provenance entry on both IssueHash and the occurrence read model.
 */
export type GroupingHashProvenance = GroupingProvenance & {
  hash: string,
  role: GroupingHashRole,
  variant: GroupingVariant,
};

/**
 * Which rule produced `ownerHash`.
 * - `app`     — hashed the in-app frames only (the normal, best case).
 * - `system`  — hashed every frame (no in-app frame, or both variants agreed).
 * - `message` — no frame contributed anything hashable, or the synthetic rule fired.
 * - `custom`  — a normalized custom or hybrid fingerprint owns the hash.
 * - `degraded`— grouping threw; a deterministic type+message hash was used instead.
 */
export type GroupingVariant = "app" | "system" | "message" | "custom" | "degraded";

export type GroupingResult = {
  configId: GroupingConfigId,
  /** THE hash. Owns the occurrence. Never empty. */
  ownerHash: string,
  /** Other variants' hashes, for ingest-time issue lookup only — never for occurrence resolution. */
  aliasHashes: string[],
  /** Explainability for transition/secondary hashes, in the same order as aliasHashes. */
  secondaryProvenance: GroupingHashProvenance[],
  variant: GroupingVariant,
  /** Human-readable "where it happened", for list rows. Never participates in any hash. */
  culprit: string,
  frames: ParsedFrame[],
  /** Explainable config/fingerprint inputs; persistence currently stores only the id and variant columns. */
  provenance: GroupingProvenance,
};
