import { createHash } from "node:crypto";
import { throwErr } from "@hexclave/shared/dist/utils/errors";
import { GROUPING_CONFIG_IDS, type GroupingConfigId, type GroupingConfigResolution } from "./grouping-config";
import { resolveGroupingFingerprint } from "./grouping-fingerprint";
import { parameterizeMessage } from "./parameterize";
import { parseStack, hasUrlOrigin, normalizeFilenameForGrouping } from "./stack-parser";
import type { GroupingHashProvenance, GroupingInput, GroupingResult, ParsedFrame } from "./types";

/**
 * Server-side error grouping.
 *
 * The whole design is one idea: reduce an occurrence to a flat, ordered list of
 * normalized string "leaves", then hash that list. Everything else here is about
 * choosing which leaves are stable enough to hash — a leaf that varies between
 * two occurrences of the same bug splits the issue, and a leaf that is missing
 * when it shouldn't be merges two different bugs.
 *
 * Two hashes are always computed:
 *  - `system` over every frame,
 *  - `app` over the same list with non-in-app frames zeroed out.
 * `app` is preferred when it exists and actually differs, because two different
 * customer bugs that both bottom out in the same `react-dom` frame must not
 * merge, while the same customer bug reached through two different library
 * call paths must.
 *
 * NOTHING in this file does I/O. It runs inline in the telemetry row builder on
 * every ingested `$error`, and it must be safe to call a few thousand times a
 * second.
 */

/**
 * U+001F (UNIT SEPARATOR). Cannot appear in a normalized leaf, and every leaf is
 * length-prefixed on top of that, which makes the encoding injective.
 *
 * Sentry hashes `md5("".join(leaves))`, which cannot distinguish `["ab","c"]`
 * from `["a","bc"]`. They are stuck with it after a decade of hash stability;
 * this encoder is not.
 */
const LEAF_SEPARATOR = "\u001F";

/** 128 bits of SHA-256. Collision-safe at issue scale and half the storage of the full digest. */
const HASH_HEX_LENGTH = 32;

/** Function names that identify nothing and would merge every anonymous callback in the file. */
const NON_CONTRIBUTING_FUNCTION_NAMES = new Set(["?", "<anonymous>", "<anonymous function>", "eval", "native"]);
/** Paths that name no file. `filename` must not contribute for these. */
const NON_CONTRIBUTING_FILENAMES = new Set(["<anonymous>", "[native code]", "native", "<unknown>"]);

/**
 * Config id → the algorithm that produced its hashes.
 *
 * A table rather than a `switch`, for two reasons. It keeps every historical
 * algorithm reachable forever — a config in a project's `readableConfigIds`
 * chain must still be *computable*, or a dormant issue that recurs after an
 * algorithm change silently becomes a new issue. And it lives here rather than
 * on `GroupingConfig` in `grouping-config.ts`, because that module must stay
 * free of any import from this one (this one imports it).
 */
type GroupingImplementation = (input: GroupingInput, configId: GroupingConfigId) => GroupingResult;

/**
 * The record is the compile-time half: `Record<GroupingConfigId, …>` is total,
 * so adding an id to the union without implementing it is a build error rather
 * than a runtime surprise on the ingest path.
 */
const GROUPING_IMPLEMENTATIONS_BY_ID: Record<GroupingConfigId, GroupingImplementation> = {
  "hexclave-js:2026-08-01": computeGroupingV1,
  "hexclave-js:2026-08-06": computeGroupingV2,
};

/**
 * The map is the runtime half. It exists rather than indexing the record
 * directly because a miss must be observable — indexing a record typed on
 * the union claims a value that a stale database row will not actually have.
 */
const GROUPING_IMPLEMENTATIONS: ReadonlyMap<GroupingConfigId, GroupingImplementation> = new Map(
  GROUPING_CONFIG_IDS.map((id) => [id, GROUPING_IMPLEMENTATIONS_BY_ID[id]] as const),
);

export function computeGrouping(input: GroupingInput, configId: GroupingConfigId): GroupingResult {
  // Resolved OUTSIDE the try: an unknown config id is a programmer error (the
  // type is a closed union, so it can only arrive through an unchecked cast or
  // a stale database row), and degrading it to the fallback hash would silently
  // regroup a project's entire history under the wrong algorithm — far worse
  // than failing loudly.
  const implementation = GROUPING_IMPLEMENTATIONS.get(configId)
    ?? throwErr(`Unknown grouping config id ${JSON.stringify(configId)}; the caller must resolve a config from GROUPING_CONFIG_IDS before grouping.`);

  try {
    return implementation(input, configId);
  } catch {
    // "No empty hash, ever" is the contract the rest of the system rests on:
    // an occurrence with no owning hash is unreachable from every issue query.
    // So a bug in here costs grouping *quality*, never queryability. The caller
    // reports `variant === "degraded"` so the degraded population stays
    // measurable and reprocessable.
    return degradedResult(input, configId);
  }
}

/**
 * Computes the active hash plus every readable historical hash for one
 * occurrence. A rollout must not make a dormant issue disappear merely
 * because its new primary algorithm is different: historical hashes are
 * lookup aliases, while only the active result owns the occurrence.
 */
export function computeGroupingWithReadableConfigs(input: GroupingInput, resolution: GroupingConfigResolution): GroupingResult {
  const primary = computeGrouping(input, resolution.activeConfigId);
  const aliasHashes = [...primary.aliasHashes];
  const secondaryProvenance = [...primary.secondaryProvenance];
  const knownHashes = new Set<string>([primary.ownerHash, ...aliasHashes]);

  for (const readableConfigId of resolution.readableConfigIds) {
    const historical = computeGrouping(input, readableConfigId);
    for (const provenance of getGroupingHashProvenance(historical)) {
      if (knownHashes.has(provenance.hash)) continue;
      knownHashes.add(provenance.hash);
      aliasHashes.push(provenance.hash);
      secondaryProvenance.push({ ...provenance, role: "secondary" });
    }
  }

  return { ...primary, aliasHashes, secondaryProvenance };
}

function computeGroupingV1(input: GroupingInput, configId: GroupingConfigId): GroupingResult {
  return computeGroupingWithRules(input, configId, false);
}

function computeGroupingV2(input: GroupingInput, configId: GroupingConfigId): GroupingResult {
  return computeGroupingWithRules(input, configId, true);
}

function computeGroupingWithRules(input: GroupingInput, configId: GroupingConfigId, includeMessageForStackedErrors: boolean): GroupingResult {
  const frames = input.stack === null ? [] : parseStack(input.stack, input.platform);
  const defaultResult = computeDefaultGroupingV1(input, configId, frames, includeMessageForStackedErrors);
  const fingerprint = resolveGroupingFingerprint(input.fingerprint, input, frames);

  if (fingerprint.provenance.type === "default") {
    return {
      ...defaultResult,
      provenance: { configId, fingerprint: fingerprint.provenance },
      secondaryProvenance: defaultResult.aliasHashes.map((hash): GroupingHashProvenance => ({
        hash,
        role: "secondary",
        configId,
        variant: "system",
        fingerprint: fingerprint.provenance,
      })),
    };
  }

  // A custom fingerprint owns one hash. A hybrid fingerprint salts the active
  // default owner into that hash, matching Sentry's "default component plus
  // custom components" semantics without treating the old hash as a lookup
  // alias. An old issue must not absorb an explicitly custom-grouped event.
  //
  // The occurrence schema has one config id and one alias array, not a
  // per-component provenance record. The smallest compatible representation is
  // therefore `variant: "custom"` plus the explainable in-process provenance;
  // the normalized row persists the owner/config/variant columns already in v1.
  const fingerprintLeaves = fingerprint.provenance.type === "hybrid"
    ? ["custom-fingerprint", defaultResult.ownerHash, ...fingerprint.resolvedValues]
    : ["custom-fingerprint", ...fingerprint.resolvedValues];

  return {
    ...defaultResult,
    ownerHash: hashLeaves(fingerprintLeaves),
    aliasHashes: [],
    variant: "custom",
    provenance: { configId, fingerprint: fingerprint.provenance },
    secondaryProvenance: [],
  };
}

type DefaultGroupingResult = Omit<GroupingResult, "provenance" | "secondaryProvenance">;

/**
 * Materialization needs one ordered record for the owner and every alias. Keep
 * this projection next to the grouping algorithm so a new variant cannot be
 * added without also making its durable role/config/fingerprint explainable.
 */
export function getGroupingHashProvenance(grouping: GroupingResult): GroupingHashProvenance[] {
  return [
    {
      hash: grouping.ownerHash,
      role: "primary",
      configId: grouping.provenance.configId,
      variant: grouping.variant,
      fingerprint: grouping.provenance.fingerprint,
    },
    ...grouping.secondaryProvenance,
  ];
}

function computeDefaultGroupingV1(input: GroupingInput, configId: GroupingConfigId, frames: ParsedFrame[], includeMessageForStackedErrors: boolean): DefaultGroupingResult {
  const culprit = deriveCulprit(frames);

  if (input.synthetic === true) {
    // `normalizeCapturedError` forces `name = "Error"` and synthesizes the
    // message for every non-`Error` throw, and the stack it synthesizes is
    // usually a single nameless URL frame that the frame rules below drop
    // outright. Without a dedicated rule, every non-Error throw in a project —
    // `throw "nope"`, `throw {code: 1}`, a rejected string — collapses into one
    // useless issue.
    const topFrame = frames.at(-1);
    const leaves = [
      "synthetic",
      parameterizeMessage(input.message),
      // The same normalized file leaf the frame rules use, NOT the raw
      // `absPath`: the raw path of a browser frame embeds the origin and the
      // per-deploy chunk content hash, so hashing it verbatim would split every
      // synthetic issue on every rebuild — exactly the instability the frame
      // rules exist to prevent.
      topFrame === undefined ? "" : frameFileLeaf(topFrame) ?? "",
    ];
    return {
      configId,
      ownerHash: hashLeaves(leaves),
      aliasHashes: [],
      // `message`, not a variant of its own: this rule is message-derived, and
      // `synthetic` is already a column on the row.
      variant: "message",
      culprit,
      frames,
    };
  }

  const systemTuples = collapseConsecutive(frames.map((frame) => frameLeafTuple(frame)));
  const systemFrameLeaves = systemTuples.flat();

  // Zeroed, NOT removed: recursion collapse has to run over the original frame
  // list, or `a -> lib -> a -> lib -> a` would collapse to a single `a` in the
  // app variant while staying five frames long in the system variant, and the
  // two variants would disagree about a stack they should agree about.
  const appTuples = collapseConsecutive(frames.map((frame) => frame.inApp ? frameLeafTuple(frame) : []));
  const appFrameLeaves = appTuples.flat();

  const systemHash = hashLeaves(buildLeaves(input, systemFrameLeaves, includeMessageForStackedErrors));

  if (systemFrameLeaves.length === 0) {
    // No frame contributed anything hashable (stackless throw, or a stack of
    // nothing but anonymous URL frames). The parameterized message is all we
    // have; hashing an empty frame list instead would merge every such error in
    // the project that shares an exception type.
    return { configId, ownerHash: systemHash, aliasHashes: [], variant: "message", culprit, frames };
  }

  // There is only an app variant to speak of when an in-app frame actually
  // contributed. Hashing the empty app list would produce the *message*
  // variant's hash, and attaching that as an alias would let an unrelated
  // stackless error of the same type and message resolve to this issue.
  const hasAppVariant = frames.some((frame) => frame.inApp) && appFrameLeaves.length > 0;
  const appHash = hasAppVariant ? hashLeaves(buildLeaves(input, appFrameLeaves, includeMessageForStackedErrors)) : null;

  // The app variant only wins when it says something different. If every frame
  // is in-app the two lists are identical, and emitting the same hash twice as
  // "owner plus alias" would just make every lookup do redundant work.
  const appVariantWins = appHash !== null && appHash !== systemHash;

  return {
    configId,
    ownerHash: appVariantWins ? appHash : systemHash,
    aliasHashes: appVariantWins ? [systemHash] : [],
    variant: appVariantWins ? "app" : "system",
    culprit,
    frames,
  };
}

/**
 * `[ type, (value only when no frame contributed), *frameLeaves ]`.
 *
 * The exception type leads. Sentry emits it first for a concrete reason: a
 * `TypeError` and a `RangeError` thrown from the same helper are different bugs
 * with different fixes, and without this leaf they share every other leaf and
 * collapse into one issue.
 */
function buildLeaves(input: GroupingInput, frameLeaves: string[], includeMessageForStackedErrors = false): string[] {
  if (frameLeaves.length === 0) return [input.type, parameterizeMessage(input.message)];
  return includeMessageForStackedErrors
    ? [input.type, parameterizeMessage(input.message), ...frameLeaves]
    : [input.type, ...frameLeaves];
}

/**
 * The leaves one frame contributes: `[module ?? filename, function, contextLine?]`.
 * A frame that contributes none of the three contributes nothing at all — it
 * still occupies a position in the tuple list so that recursion collapse can see
 * it, but it adds no leaves.
 */
function frameLeafTuple(frame: ParsedFrame): string[] {
  const tuple: string[] = [];

  const fileLeaf = frameFileLeaf(frame);
  if (fileLeaf !== null) tuple.push(fileLeaf);

  const functionLeaf = frameFunctionLeaf(frame);
  if (functionLeaf !== null) tuple.push(functionLeaf);

  // ⚠️ `context` is filled by SYMBOLICATION, which is read-time — so at ingest,
  // where this runs, it is always absent and this branch never fires today. It
  // is here because the leaf order is part of the config's contract and must be
  // written down once.
  //
  // The trap it guards: if a future change ever symbolicates BEFORE grouping,
  // this leaf starts contributing and every hash in every project changes with
  // no error anywhere. Populating `context` before `computeGrouping` therefore
  // requires a new `GroupingConfigId`, exactly like editing the rules would.
  const contextLine = frame.context?.line.trim();
  if (contextLine !== undefined && contextLine !== "") tuple.push(contextLine);

  // `lineno`/`colno` are deliberately absent from every branch above: they move
  // on any edit to the file, which would split an issue on an unrelated commit.
  return tuple;
}

function frameFileLeaf(frame: ParsedFrame): string | null {
  // Module wins over filename: it is already origin-independent and
  // content-hash-stripped, so it survives both a domain change and a rebuild.
  if (frame.module !== null && frame.module !== "") return frame.module;

  const filename = frame.filename;
  if (filename === null || filename === "") return null;

  const basename = filename.split(/[/\\]/).at(-1)?.toLowerCase() ?? "";
  if (basename === "") return null;
  if (NON_CONTRIBUTING_FILENAMES.has(basename)) return null;
  // A URL-origin frame's basename is deployment noise (`main-a1b2c3.js`); the
  // module derived from the same path is the stable form and was preferred above.
  if (frame.absPath !== null && hasUrlOrigin(frame.absPath)) return null;

  return normalizeFilenameForGrouping(basename);
}

function frameFunctionLeaf(frame: ParsedFrame): string | null {
  const func = frame.function;
  if (func === null || func === "") return null;

  // `Foo.prototype.bar` and `bar` are the same function reached two ways, and V8
  // renders the same call either way depending on how it was invoked.
  const tail = func.split(".").at(-1) ?? func;
  if (tail === "") return null;
  if (NON_CONTRIBUTING_FUNCTION_NAMES.has(tail)) return null;
  // Gecko appends `/<` to every nested closure (`init/<`, `e.fn[c]/<`); the
  // suffix changes whenever an unrelated closure is added above it.
  if (tail.endsWith("/<")) return null;

  return tail;
}

/**
 * Collapses runs of identical frames so that a stack overflow (the same frame
 * repeated hundreds of times, at a depth that depends on the call site) groups
 * with itself rather than producing a new issue per recursion depth.
 */
function collapseConsecutive(tuples: string[][]): string[][] {
  const collapsed: string[][] = [];
  for (const tuple of tuples) {
    const previous = collapsed.at(-1);
    if (previous !== undefined && previous.length === tuple.length && previous.every((leaf, index) => leaf === tuple.at(index))) {
      continue;
    }
    collapsed.push(tuple);
  }
  return collapsed;
}

/**
 * "Where it happened", for list rows. Never hashed — it is free to change shape
 * without splitting anything.
 *
 * Frames are oldest-first, so the crash site is last. The last *in-app* frame is
 * preferred: a `TypeError` raised inside `react-dom` is reported at the
 * customer's component, not at React's internals.
 */
function deriveCulprit(frames: ParsedFrame[]): string {
  const frame = [...frames].reverse().find((candidate) => candidate.inApp) ?? frames.at(-1);
  if (frame === undefined) return "<unknown>";
  const location = frame.filename ?? frame.absPath ?? "<unknown>";
  return frame.function === null ? location : `${frame.function} (${location})`;
}

/**
 * SHA-256 over length-prefixed, separator-delimited leaves, truncated to 128 bits.
 */
function hashLeaves(leaves: string[]): string {
  const digest = createHash("sha256");
  for (const leaf of leaves) {
    digest.update(String(leaf.length));
    digest.update(LEAF_SEPARATOR);
    digest.update(leaf, "utf8");
  }
  return digest.digest("hex").slice(0, HASH_HEX_LENGTH);
}

/**
 * The last line of defence. Deterministic, never empty, and deliberately
 * identical to the message variant's encoding — so a degraded occurrence lands
 * in the *same* issue as a correctly-grouped message-variant occurrence of the
 * same error, instead of spawning an orphan issue nobody will ever look at.
 */
function degradedResult(input: GroupingInput, configId: GroupingConfigId): GroupingResult {
  let parameterized: string;
  try {
    parameterized = parameterizeMessage(input.message);
  } catch {
    // If even parameterization failed, the message is unusable; the type alone
    // still produces a stable, non-empty hash.
    parameterized = "";
  }
  return {
    configId,
    ownerHash: hashLeaves([input.type, parameterized]),
    aliasHashes: [],
    variant: "degraded",
    culprit: "<unknown>",
    frames: [],
    provenance: {
      configId,
      fingerprint: {
        // The fallback itself does not resolve custom values. Keeping the raw
        // contract visible, while marking the source as degraded, is more
        // useful than claiming that an invalid custom request was honored.
        type: input.fingerprint === undefined || input.fingerprint.length === 0 ? "default" : "custom",
        source: "degraded",
        tokens: input.fingerprint === undefined ? [] : [...input.fingerprint],
        resolvedTokens: [],
      },
    },
    secondaryProvenance: [],
  };
}
