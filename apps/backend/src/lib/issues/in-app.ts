import type { StackPlatform } from "./types";

/**
 * The single source of truth for "is this frame the customer's own code?".
 *
 * Two consumers depend on this agreeing exactly: the ingest-time stack parser
 * (which stamps `inApp` onto every frame, feeding the `app` grouping variant)
 * and read-time symbolication (which re-derives `inApp` from the *original*
 * path recovered from a source map). If those two ever disagreed, a symbolicated
 * frame would render as in-app while the hash that owns it was computed from a
 * system frame — i.e. the UI would show a stack that cannot produce that issue.
 *
 * This is a hardcoded ruleset, not Sentry's user-configurable enhancer DSL. The
 * DSL is a large surface with its own parser and cache, and grouping does not
 * currently need per-project overrides.
 *
 * The node branch is ported from Sentry's `filenameIsInApp`
 * (`packages/core/src/utils/node-stack-trace.ts`), originally forked from
 * https://github.com/felixge/node-stack-trace — see the attribution header in
 * `stack-parser.ts`.
 */

/**
 * Bundler/runtime paths that are never the customer's source, on the browser
 * side. `/~/` is legacy webpack's module-directory marker (`webpack:///./~/pkg/…`
 * meant `node_modules/pkg`), still seen from older toolchains; treating it as
 * app code would pull third-party frames into the `app` grouping hash.
 */
const JAVASCRIPT_NOT_IN_APP_SUBSTRINGS = ["/node_modules/"];
const LEGACY_WEBPACK_MODULE_PATH = "webpack:///./~/";
const JAVASCRIPT_NOT_IN_APP_PREFIXES = ["webpack-internal:", "node:"];
/**
 * Next.js emits its own runtime into `framework-<hash>.js` under this directory.
 * It is the single biggest source of noise in a Next app's stacks, and unlike
 * `node_modules` it never appears in the URL after bundling.
 */
const NEXT_FRAMEWORK_CHUNK_PREFIX = "/_next/static/chunks/framework";

/** Paths V8 uses for frames that have no file at all. Not app code, not system code — just unknown. */
const NON_FILE_PATHS = new Set(["<anonymous>", "[native code]", "native", "<unknown>"]);

const WINDOWS_ABSOLUTE_PATH_RE = /^[a-zA-Z]:/;
/**
 * `node_modules` as a whole path segment, under either separator. The Windows
 * branch above accepts `C:\…` paths as potential app code, so the dependency
 * exclusion must understand backslashes too — a plain `includes("node_modules/")`
 * would classify `C:\app\node_modules\pkg\index.js` as in-app and change grouping.
 */
const NODE_MODULES_SEGMENT_RE = /(?:^|[\\/])node_modules[\\/]/;
// Schema from https://stackoverflow.com/a/3641782 — `scheme://`, i.e. the frame
// went through a bundler or came off the network rather than off disk.
const URL_SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9.\-+]*:\/\//;

export function isInAppPath(path: string, platform: StackPlatform): boolean {
  // An unknown path is not app code. Sentry's port returns `true` here, but only
  // as a side effect of `""` being falsy in the middle of a `&&` chain — it is a
  // quirk of that expression, not a decision, and treating unknown frames as
  // app code would make the `app` grouping variant hash frames it cannot show.
  if (path === "") return false;
  if (NON_FILE_PATHS.has(path)) return false;

  switch (platform) {
    case "javascript": {
      if (JAVASCRIPT_NOT_IN_APP_PREFIXES.some((prefix) => path.startsWith(prefix))) return false;
      if (JAVASCRIPT_NOT_IN_APP_SUBSTRINGS.some((needle) => path.includes(needle))) return false;
      if (path.includes(LEGACY_WEBPACK_MODULE_PATH)) return false;
      // Matched on the pathname so it holds for both `https://host/_next/...` and a bare `/_next/...`.
      if (path.includes(NEXT_FRAMEWORK_CHUNK_PREFIX)) return false;
      return true;
    }
    case "node": {
      // Ported from `filenameIsInApp`. In Node the polarity is inverted relative
      // to the browser: a frame is app code only when it names a real file on
      // disk. Anything without an absolute/relative path prefix is a Node
      // builtin (`internal/process/task_queues.js`, `events.js`), and anything
      // with a URL scheme went through a bundler.
      const isBuiltinOrBundled = !path.startsWith("/")
        && !WINDOWS_ABSOLUTE_PATH_RE.test(path)
        && !path.startsWith(".")
        && !URL_SCHEME_RE.test(path);
      if (isBuiltinOrBundled) return false;
      return !NODE_MODULES_SEGMENT_RE.test(path);
    }
  }
}
