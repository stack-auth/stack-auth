import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Why this script exists:
 * - Next.js dev app-page runtimes (app-page*.runtime.dev.js) include an async debug hook
 *   (`async_hooks.createHook`) that captures async stack-trace metadata in hot paths.
 * - In our backend dev workload (notably repeated email-queue-step requests), this hook
 *   causes measurable heap growth/retention in dev mode.
 * - We disable that hook when STACK_DISABLE_REACT_ASYNC_DEBUG_INFO=true.
 *
 * Why we do this in postinstall:
 * - The equivalent pnpm patch touched minified one-line bundles and produced a multi-MB
 *   patch file that is hard to review and noisy in diffs.
 * - A strict install-time rewrite keeps the repo clean while still being deterministic:
 *   if assumptions no longer hold, we fail loudly instead of silently continuing.
 */
const LOG_PREFIX = "[patch-next-async-debug-info]";
const MIN_TARGET_NEXT_MAJOR = 16;

// We only patch app-page dev runtimes where this hook is present and relevant.
const APP_PAGE_RUNTIME_FILE_REGEX = /^app-page(?:-turbo)?(?:-experimental)?\.runtime\.dev\.js$/;
const HOOK_NEEDLE = "doNotLimit=new WeakSet;async_hooks.createHook(";
const GUARDED_HOOK =
  "doNotLimit=new WeakSet,shouldEnableAsyncDebugInfo=\"true\"!==process.env.STACK_DISABLE_REACT_ASYNC_DEBUG_INFO;shouldEnableAsyncDebugInfo&&async_hooks.createHook(";
// Extra fingerprints reduce the chance of accidentally patching unrelated files.
const RUNTIME_FINGERPRINTS = [
  "collectStackTracePrivate(",
  "pendingOperations",
];

function fail(message) {
  throw new Error(`${LOG_PREFIX} ${message}`);
}

function hasAllRuntimeFingerprints(content) {
  return RUNTIME_FINGERPRINTS.every((fingerprint) => content.includes(fingerprint));
}

function patchRuntimeFile(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const hasNeedle = content.includes(HOOK_NEEDLE);
  const hasGuard = content.includes(GUARDED_HOOK);

  if (!hasAllRuntimeFingerprints(content)) {
    return { status: "ignored" };
  }

  if (hasNeedle && hasGuard) {
    fail(`File ${filePath} contains both guarded and unguarded markers; refusing to continue.`);
  }

  if (!hasNeedle && !hasGuard) {
    fail(`File ${filePath} no longer contains the expected async debug marker. Next.js internals likely changed.`);
  }

  // Already guarded => idempotent no-op.
  if (hasGuard) {
    return { status: "already" };
  }

  const needleCount = content.split(HOOK_NEEDLE).length - 1;
  if (needleCount !== 1) {
    fail(`File ${filePath} matched ${needleCount} unguarded markers (expected exactly 1).`);
  }

  const patchedContent = content.replace(HOOK_NEEDLE, GUARDED_HOOK);

  if (patchedContent === content) {
    fail(`File ${filePath} did not change after replacement.`);
  }

  if (patchedContent.includes(HOOK_NEEDLE)) {
    fail(`File ${filePath} still contains unguarded marker after patch.`);
  }

  if (!patchedContent.includes(GUARDED_HOOK)) {
    fail(`File ${filePath} is missing guarded marker after patch.`);
  }

  fs.writeFileSync(filePath, patchedContent);

  return { status: "patched" };
}

function listInstalledNextServerDirs(repoRoot) {
  const pnpmVirtualStoreDir = path.join(repoRoot, "node_modules", ".pnpm");
  if (!fs.existsSync(pnpmVirtualStoreDir)) {
    fail(`Missing ${pnpmVirtualStoreDir}. Run pnpm install before applying this patch.`);
  }

  const dirEntries = fs.readdirSync(pnpmVirtualStoreDir, { withFileTypes: true });
  const nextServerDirs = dirEntries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("next@"))
    .map((entry) => {
      const versionMatch = entry.name.match(/^next@(\d+)\./);
      if (!versionMatch) {
        return null;
      }

      const majorVersion = Number(versionMatch[1]);
      // This guard targets current Next 16 dev runtimes only; older installed versions
      // (e.g. transitive Next 14) may not contain the same runtime structure.
      if (majorVersion < MIN_TARGET_NEXT_MAJOR) {
        return null;
      }

      const nextServerDir = path.join(
        pnpmVirtualStoreDir,
        entry.name,
        "node_modules",
        "next",
        "dist",
        "compiled",
        "next-server",
      );

      return fs.existsSync(nextServerDir) ? nextServerDir : null;
    })
    .filter((nextServerDir) => nextServerDir !== null);

  if (nextServerDirs.length === 0) {
    fail(`No installed Next.js runtimes with major >= ${MIN_TARGET_NEXT_MAJOR} found in node_modules/.pnpm.`);
  }

  return nextServerDirs;
}

function patchAllNextRuntimeDirs(repoRoot) {
  const nextServerDirs = listInstalledNextServerDirs(repoRoot);

  const summary = {
    nextServerDirs: nextServerDirs.length,
    candidateFiles: 0,
    fingerprintedFiles: 0,
    patchedFiles: 0,
    alreadyPatchedFiles: 0,
  };

  for (const nextServerDir of nextServerDirs) {
    const runtimeFiles = fs.readdirSync(nextServerDir)
      .filter((fileName) => APP_PAGE_RUNTIME_FILE_REGEX.test(fileName))
      .map((fileName) => path.join(nextServerDir, fileName));

    if (runtimeFiles.length === 0) {
      fail(`No app-page*.runtime.dev.js files found in ${nextServerDir}.`);
    }

    summary.candidateFiles += runtimeFiles.length;

    let touchedFingerprintFileInDir = 0;
    for (const runtimeFile of runtimeFiles) {
      const result = patchRuntimeFile(runtimeFile);
      if (result.status === "ignored") {
        continue;
      }

      touchedFingerprintFileInDir += 1;
      summary.fingerprintedFiles += 1;

      if (result.status === "patched") {
        summary.patchedFiles += 1;
      } else if (result.status === "already") {
        summary.alreadyPatchedFiles += 1;
      } else {
        fail(`Unexpected patch status "${result.status}" for ${runtimeFile}.`);
      }
    }

    if (touchedFingerprintFileInDir === 0) {
      fail(`Found app-page runtimes in ${nextServerDir}, but none matched expected async debug fingerprints.`);
    }
  }

  if (summary.fingerprintedFiles === 0) {
    fail("No runtime files matched expected async debug fingerprints.");
  }

  if (summary.patchedFiles === 0 && summary.alreadyPatchedFiles === 0) {
    fail("Patch script completed without touching any files.");
  }

  return summary;
}

function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDir, "..");
  const summary = patchAllNextRuntimeDirs(repoRoot);

  // Emit a compact machine-readable summary for local debugging and CI logs.
  console.log(
    `${LOG_PREFIX} patched=${summary.patchedFiles} alreadyPatched=${summary.alreadyPatchedFiles} ` +
    `fingerprinted=${summary.fingerprintedFiles} candidates=${summary.candidateFiles} nextDirs=${summary.nextServerDirs}`,
  );
}

main();
