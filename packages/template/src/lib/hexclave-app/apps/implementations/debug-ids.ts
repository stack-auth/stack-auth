import { type DebugImage, ERROR_MAX_DEBUG_IMAGES, ERROR_MAX_DEBUG_IMAGES_BYTES } from "@hexclave/shared/dist/utils/analytics-wire";

/**
 * Debug-id lookup for `$error` source mapping.
 *
 * `hexclave sourcemaps upload` appends a tiny snippet to every emitted bundle
 * chunk. That snippet runs from inside the chunk, takes `new Error().stack`,
 * and stores `globalThis._hexclaveDebugIds[<that stack string>] = <debug id>`.
 * Because the stack was created inside the chunk, its innermost frame names the
 * chunk's own file — which is how a runtime with no bundler integration learns
 * "this URL was built from that source map".
 *
 * Two constraints shape everything below:
 *
 *  1. This module lives in the client bundle and the SDK deliberately has NO
 *     stack parser (see the header of error-capture.ts — parsing and grouping
 *     stay server-side). So we do the absolute minimum: one regex that pulls
 *     the innermost frame's file location out of a stack string.
 *  2. The raw global maps FULL STACK STRINGS to debug ids. A page with 30-100
 *     chunks holds 30-100 keys of 100-500 bytes each; shipping those keys would
 *     single-handedly exceed CUSTOM_TELEMETRY_MAX_ITEM_DATA_BYTES (64 KB). So
 *     the keys are collapsed to one filename each, and only the filenames that
 *     literally occur in the erroring stack are attached to the event.
 */

// The global the injected snippet writes to (mirrors Sentry's
// `_sentryDebugIds`, but under our own name so the two can coexist in an app
// that runs both SDKs). Keys are stack strings, values are debug ids.
const DEBUG_IDS_GLOBAL_KEY = "_hexclaveDebugIds";

/**
 * Pulls the file location out of the innermost resolvable frame of a stack.
 *
 * Handles, in one pass over the lines:
 *  - V8 with a function name:  `    at fn (https://x/a.js:1:2)`
 *  - V8 without one:           `    at https://x/a.js:1:2`
 *  - SpiderMonkey / JSC:       `fn@https://x/a.js:1:2`, `@https://x/a.js:1:2`
 *  - Bare filesystem paths:    `    at fn (/var/task/.next/server/chunks/1.js:1:2)`
 *    Node stacks are absolute paths, not URLs, and server chunks are exactly
 *    the case source maps are hardest to get for — dropping them would silently
 *    make server-side symbolication impossible.
 *  - Windows paths:            `    at fn (C:\app\.next\server\x.js:1:2)`
 *
 * Frames with no location at all (`at <anonymous>`, `at Module._compile`) are
 * skipped rather than aborting, so "innermost" means "innermost frame we can
 * actually name a file for". Returns null when no line yields one.
 */
export function extractInnermostFrameFilename(stack: string): string | null {
  for (const line of stack.split("\n")) {
    // The location is anchored to the END of the line so a function name that
    // happens to contain `/` or `:` can't be mistaken for the file. The leading
    // `at ` / `(` / `@` alternatives are the three ways every engine introduces
    // it. The column is optional: a few engines emit `file:line` only.
    // Whitespace IS allowed inside the path (`[^()]`, not `[^\s()]`): local
    // builds regularly live under directories with spaces ("Program Files",
    // iCloud paths), and excluding them would silently drop `debug_images` for
    // every error those builds produce. The end anchor plus the `:line[:col]`
    // suffix keeps the terminal delimiter unambiguous either way.
    const match = /(?:\bat\s+|[(@])((?:[a-zA-Z][a-zA-Z0-9+.-]*:\/{2,3}|\/|[a-zA-Z]:[\\/])[^()]*?):\d+(?::\d+)?\)?\s*$/.exec(line);
    if (match !== null) return match[1];
  }
  return null;
}

function readDebugIdsGlobal(): object | null {
  // try-catch is deliberate (normally banned in this codebase): another script
  // may define this global as a throwing accessor or a hostile Proxy, and this
  // read sits on the error-capture hot path — a throw HERE would drop the
  // original `$error` (and arm the capture path's ignore-next counter, hiding
  // the following genuine error too). Debug-image enrichment is optional, so
  // an unreadable registry degrades to "no images", never to a lost event.
  try {
    const value: unknown = Reflect.get(globalThis, DEBUG_IDS_GLOBAL_KEY);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    return value;
  } catch {
    return null;
  }
}

// Memoization state. The map is derived from every key of the global, and each
// derivation runs the frame regex over a full stack string, so recomputing it
// on every captured error would be O(chunks x stack length) per error — right
// when the app is already unhealthy.
let cachedSource: object | null = null;
let cachedEntries: readonly (readonly [string, unknown])[] | null = null;
let cachedMap: ReadonlyMap<string, string> | null = null;

function resetDebugIdCache(): void {
  cachedSource = null;
  cachedEntries = null;
  cachedMap = null;
}

/**
 * `filename -> debug id` for every chunk that has registered itself, memoized.
 *
 * Cache validity is checked EXACTLY: same global object identity, same key
 * count, and every previously seen key still holds the identical value. The
 * value re-reads are O(chunks) cheap property gets; what the memo actually
 * avoids is re-running the frame regex over every full stack-string key. A
 * count-only check would be almost always sufficient (the snippet only ever
 * adds keys, and ids are derived from chunk bytes), but a dev-server rebuild
 * can re-serve the same URL with a same-shaped stack key and a NEW id — the
 * value comparison catches that overwrite instead of serving a stale id.
 * (A removed-and-replaced key at the same count is caught too: the removed
 * cached key now reads `undefined`, which mismatches its cached value.)
 */
export function getFilenameToDebugIdMap(): ReadonlyMap<string, string> {
  // Guarded like readDebugIdsGlobal and for the same reason: `Object.keys` and
  // the per-key reads hit Proxy traps on a hostile registry, and error capture
  // must survive that. Fail closed to an empty map.
  try {
    const debugIds = readDebugIdsGlobal();
    if (debugIds === null) {
      resetDebugIdCache();
      return new Map();
    }
    const keys = Object.keys(debugIds);
    if (
      cachedMap !== null
      && cachedSource === debugIds
      && cachedEntries !== null
      && keys.length === cachedEntries.length
      && cachedEntries.every(([key, value]) => Reflect.get(debugIds, key) === value)
    ) {
      return cachedMap;
    }

    const map = new Map<string, string>();
    const entries: (readonly [string, unknown])[] = [];
    for (const key of keys) {
      const debugId: unknown = Reflect.get(debugIds, key);
      entries.push([key, debugId]);
      if (typeof debugId !== "string" || debugId === "") continue;
      const filename = extractInnermostFrameFilename(key);
      if (filename === null) continue;
      // Last writer wins. Two chunks cannot produce the same innermost filename
      // in a correct build; if they do (a stale artifact re-registering an old
      // id), the most recently executed one is the one actually serving code.
      map.set(filename, debugId);
    }

    cachedSource = debugIds;
    cachedEntries = entries;
    cachedMap = map;
    return map;
  } catch {
    resetDebugIdCache();
    return new Map();
  }
}

const textEncoder = new TextEncoder();

/**
 * First occurrence of `codeFile` in `stack` that reads as a complete frame
 * location, i.e. is immediately followed by `:<line digit>`. A bare
 * `String.includes` could bind a registered filename to a frame whose location
 * merely STARTS with it (`https://x/app.js` inside `https://x/app.js.old:1:1`,
 * or an unversioned URL prefixing a versioned one), attaching the wrong debug
 * id — and therefore symbolicating with the wrong source map. Every engine
 * writes frame locations as `<file>:<line>[:<col>]`, so requiring the `:digit`
 * boundary is exact without any per-frame parsing.
 */
function indexOfFrameLocation(stack: string, codeFile: string): number {
  let from = 0;
  while (true) {
    const index = stack.indexOf(codeFile, from);
    if (index < 0) return -1;
    const end = index + codeFile.length;
    const lineStart = stack.lastIndexOf("\n", index - 1) + 1;
    const linePrefix = stack.slice(lineStart, index);
    const hasFrameDelimiter = linePrefix.endsWith("at ")
      || linePrefix.endsWith("(")
      || linePrefix.endsWith("@");
    if (hasFrameDelimiter && stack.charCodeAt(end) === 0x3a /* ":" */) {
      const digit = stack.charCodeAt(end + 1);
      if (digit >= 0x30 && digit <= 0x39) return index;
    }
    from = index + 1;
  }
}

/**
 * The `debug_images` to attach to one `$error`: the registered chunks whose
 * filename occurs as a frame location in THIS error's stack, innermost first.
 *
 * Matching is a substring scan with a `:line` boundary check against the
 * (already truncated) stack — no parsing, no per-frame work. Ordering is by
 * first occurrence so that when either cap trims the list, the frames nearest
 * the throw site — the ones a human opens first — are the ones that survive.
 * Both caps `break` rather than `continue` for the same reason: skipping a
 * long entry to squeeze in a shorter outer one would silently reorder
 * usefulness.
 */
export function getDebugImagesForStack(stack: string | null): DebugImage[] {
  if (stack === null || stack === "") return [];
  const filenameToDebugId = getFilenameToDebugIdMap();
  if (filenameToDebugId.size === 0) return [];

  const matches: { index: number, image: DebugImage }[] = [];
  for (const [codeFile, debugId] of filenameToDebugId) {
    const index = indexOfFrameLocation(stack, codeFile);
    if (index < 0) continue;
    matches.push({ index, image: { code_file: codeFile, debug_id: debugId } });
  }
  matches.sort((a, b) => a.index - b.index);

  const images: DebugImage[] = [];
  // Budget accounting mirrors what JSON.stringify(images) will actually cost:
  // the enclosing `[]` plus one `,` between entries.
  let bytes = 2;
  for (const { image } of matches) {
    if (images.length >= ERROR_MAX_DEBUG_IMAGES) break;
    const entryBytes = textEncoder.encode(JSON.stringify(image)).length + (images.length > 0 ? 1 : 0);
    if (bytes + entryBytes > ERROR_MAX_DEBUG_IMAGES_BYTES) break;
    bytes += entryBytes;
    images.push(image);
  }
  return images;
}
