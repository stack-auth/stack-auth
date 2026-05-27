// PR 2 — Hexclave rebrand. When the SDK is loaded from a legacy `@stackframe/*`
// package, emit a once-per-process console.warn pointing to the `@hexclave/*`
// equivalent. The published `@hexclave/*` packages reuse the exact same built
// artifacts, so we detect the package brand at runtime from `clientVersion`
// (which the tsdown plugin stamps from package.json at build time).
//
// Repeated SDK imports within one process are de-duplicated via a Symbol on
// globalThis — multiple bundlers / dynamic imports won't spam the console.

import { clientVersion } from "../lib/stack-app/apps/implementations/common";

const WARNED_SYMBOL = Symbol.for("Hexclave--stackframe-package-deprecation-warned");

function shouldWarn(): boolean {
  // clientVersion is "js <package-name>@<version>" once the build-time sentinel
  // is rewritten. In a built `@stackframe/*` artifact this looks like
  // "js @stackframe/stack@2.8.92"; in `@hexclave/*` artifacts it looks like
  // "js @hexclave/next@1.0.0". Anything else (template build, source mode) is
  // a no-op.
  return /^js @stackframe\//.test(clientVersion);
}

function warnOnce() {
  const g = globalThis as Record<symbol, unknown>;
  if (g[WARNED_SYMBOL]) return;
  g[WARNED_SYMBOL] = true;
  // Best-effort advisory. Wrapped in try/catch because some sandboxed
  // runtimes (older Workers, embedded JS hosts) stub or omit `console`;
  // a throw here would break the consuming bundle on SDK import.
  try {
    if (typeof console !== "undefined" && typeof console.warn === "function") {
      // eslint-disable-next-line no-console
      console.warn(
        `[Hexclave] You are using the legacy ${extractPackageName()} package. ` +
        `Please migrate to the @hexclave/* equivalent — the API surface is identical ` +
        `and the @stackframe/* packages are deprecated. See https://docs.hexclave.com/migration.`,
      );
    }
  } catch {
    // swallow: the warning is best-effort, never load-bearing.
  }
}

function extractPackageName(): string {
  // "js @stackframe/stack@2.8.92" → "@stackframe/stack"
  const match = clientVersion.match(/^js (@stackframe\/[^@]+)@/);
  return match ? match[1] : "@stackframe/*";
}

if (shouldWarn()) {
  warnOnce();
}
