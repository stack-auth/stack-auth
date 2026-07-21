import { WORKFLOW_SOURCE_MAX_BYTES, workflowPlatformEventTypes, workflowLifecycleEventTypes, WORKFLOW_CUSTOM_EVENT_PREFIX, type WorkflowManifestJson } from "@hexclave/shared/dist/interface/workflows";
import { bundleJavaScript } from "@hexclave/shared/dist/utils/esbuild";
import { Result } from "@hexclave/shared/dist/utils/results";
import { createHash } from "node:crypto";
import { isValidTimezone, parseCronExpression } from "./cron";
import { invokeWorkflowSandbox } from "./invoke";
import { WORKFLOWS_DEFAULT_LIMITS, WORKFLOWS_PROTOCOL_VERSION, type WorkflowSandboxManifest } from "./protocol";
import { getWorkflowsRuntimeEnv, WORKFLOWS_CURRENT_RUNTIME_ENV_VERSION } from "./runtime-env";
import { WORKFLOWS_ENTRY_JS, WORKFLOWS_RUNTIME_PACKAGE_SOURCE } from "./runtime-source";

// Sync-time pipeline: raw source string -> validation -> esbuild bundle ->
// manifest-mode sandbox execution. Everything that can be rejected is
// rejected HERE, at sync time, with an explicit error — never as a runtime
// surprise inside a run.

/**
 * v1 workflows are self-contained files: the only allowed imports are the
 * "@hexclave/workflows" contract and the pinned stdlib. Everything else is
 * rejected at sync time.
 */
const IMPORT_ALLOWLIST_EXACT = ["@hexclave/workflows"];
const STDLIB_PACKAGES = ["date-fns"];

// Written for module specifiers in static imports, re-exports, dynamic
// imports, and requires. Comments/strings can theoretically fool a regex
// scan, but esbuild's bundling is the correctness backstop (an unresolvable
// import fails the build); this scan exists to produce a NICE error message
// and to detect stdlib usage.
const IMPORT_SPECIFIER_REGEXES = [
  /(?:^|[\n;])\s*import\s+(?:type\s+)?[^'"]*?from\s*['"]([^'"]+)['"]/g,
  /(?:^|[\n;])\s*import\s*['"]([^'"]+)['"]/g,
  /(?:^|[\n;])\s*export\s+[^'"]*?from\s*['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

export function scanWorkflowImports(source: string): string[] {
  const specifiers = new Set<string>();
  for (const regex of IMPORT_SPECIFIER_REGEXES) {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(source)) !== null) {
      specifiers.add(match[1]);
    }
  }
  return [...specifiers];
}

function isAllowedImport(specifier: string): boolean {
  if (IMPORT_ALLOWLIST_EXACT.includes(specifier)) return true;
  // Stdlib packages may be imported under their own names, incl. subpaths.
  return STDLIB_PACKAGES.some((pkg) => specifier === pkg || specifier.startsWith(`${pkg}/`));
}

export function getUsedStdlibPackages(source: string): string[] {
  const specifiers = scanWorkflowImports(source);
  return STDLIB_PACKAGES.filter((pkg) => specifiers.some((s) => s === pkg || s.startsWith(`${pkg}/`)));
}

export function validateWorkflowSource(source: string): Result<null, string> {
  const sizeBytes = Buffer.byteLength(source, "utf8");
  if (sizeBytes > WORKFLOW_SOURCE_MAX_BYTES) {
    return Result.error(`Workflow source is ${sizeBytes} bytes, exceeding the ${WORKFLOW_SOURCE_MAX_BYTES}-byte (128 KiB) limit`);
  }
  // Non-literal imports can evade an allowlist scanner and resolve arbitrary
  // packages or Node built-ins at runtime. Workflows do not need dynamic
  // module loading, so reject import()/require() entirely instead of trying
  // to approximate JavaScript parsing with a permissive regex.
  if (/\b(?:import|require)\s*\(/.test(source)) {
    return Result.error("Dynamic import() and require() are not supported in workflows. Use a static import from the allowed packages.");
  }
  const disallowed = scanWorkflowImports(source).filter((s) => !isAllowedImport(s));
  if (disallowed.length > 0) {
    return Result.error(
      `v1 workflows are self-contained: the only allowed imports are "@hexclave/workflows" and the pinned stdlib (${STDLIB_PACKAGES.join(", ")}). ` +
      `Disallowed imports: ${disallowed.map((s) => JSON.stringify(s)).join(", ")}. ` +
      `Inline small helpers directly in the workflow file; hexclaveApp does the heavy lifting.`,
    );
  }
  return Result.ok(null);
}

export function computeWorkflowSourceHash(source: string, runtimeEnvVersion: string): string {
  // The version hash covers source + runtime env: a version is minted
  // whenever either changes (env upgrades apply to new versions only).
  return createHash("sha256").update(source).update("\0").update(runtimeEnvVersion).digest("hex");
}

export async function compileWorkflowBundle(source: string): Promise<Result<{ compiledBundle: string, usesStdlib: string[] }, string>> {
  const validation = validateWorkflowSource(source);
  if (validation.status === "error") return Result.error(validation.error);

  const bundleResult = await bundleJavaScript({
    "/workflow.ts": source,
    "/entry.js": WORKFLOWS_ENTRY_JS,
  }, {
    externalPackages: {
      "@hexclave/workflows": WORKFLOWS_RUNTIME_PACKAGE_SOURCE,
    },
    // The stdlib stays a real import, resolved against the sandbox's
    // nodeModules at the exact pinned version.
    keepAsImports: [...STDLIB_PACKAGES, "@hexclave/js"],
    format: "esm",
    sourcemap: false,
  });
  if (bundleResult.status === "error") {
    return Result.error(`Workflow source failed to compile: ${bundleResult.error}`);
  }
  return Result.ok({ compiledBundle: bundleResult.data, usesStdlib: getUsedStdlibPackages(source) });
}

function validateManifest(manifest: WorkflowSandboxManifest, expectedWorkflowId: string): Result<null, string> {
  if (manifest.workflowId !== expectedWorkflowId) {
    return Result.error(`The workflow file defines workflow "${manifest.workflowId}", but this workflow is "${expectedWorkflowId}". The id in workflow(...) must match.`);
  }
  const knownUnprefixedEventTypes = new Set<string>([...workflowPlatformEventTypes, ...workflowLifecycleEventTypes]);
  for (const trigger of manifest.triggers) {
    if (trigger.type === "event") {
      if (!trigger.eventType.startsWith(WORKFLOW_CUSTOM_EVENT_PREFIX) && !knownUnprefixedEventTypes.has(trigger.eventType)) {
        return Result.error(
          `Unknown platform event type "${trigger.eventType}". ` +
          `Platform events: ${[...knownUnprefixedEventTypes].join(", ")}. ` +
          `For custom events, use customEvent("name") (subscribes to "custom.name").`,
        );
      }
    } else {
      const cronResult = parseCronExpression(trigger.cron);
      if (cronResult.status === "error") return Result.error(cronResult.error);
      if (!isValidTimezone(trigger.timezone)) {
        return Result.error(`Invalid schedule timezone "${trigger.timezone}" (must be an IANA timezone like "America/Los_Angeles")`);
      }
    }
  }
  return Result.ok(null);
}

/**
 * Compiles the source and executes the bundle in manifest mode to extract
 * trigger declarations as data. Manifest extraction runs the file's
 * top-level code in the sandbox, so it also validates that the file actually
 * loads and default-exports a matching workflow.
 */
export async function compileAndExtractWorkflowManifest(source: string, expectedWorkflowId: string): Promise<Result<{
  compiledBundle: string,
  manifest: WorkflowManifestJson,
  runtimeEnvVersion: string,
  sourceHash: string,
}, string>> {
  const compileResult = await compileWorkflowBundle(source);
  if (compileResult.status === "error") return Result.error(compileResult.error);
  const { compiledBundle, usesStdlib } = compileResult.data;

  const runtimeEnvVersion = WORKFLOWS_CURRENT_RUNTIME_ENV_VERSION;
  const runtimeEnv = getWorkflowsRuntimeEnv(runtimeEnvVersion);
  const nodeModules = {
    ...runtimeEnv.runtimeNodeModules,
    ...Object.fromEntries(Object.entries(runtimeEnv.stdlibNodeModules).filter(([pkg]) => usesStdlib.includes(pkg))),
  };

  const invocationResult = await invokeWorkflowSandbox({
    compiledBundle,
    input: {
      protocolVersion: WORKFLOWS_PROTOCOL_VERSION,
      mode: "manifest",
      limits: WORKFLOWS_DEFAULT_LIMITS,
    },
    nodeModules,
    timeoutMs: 60_000,
  });
  if (invocationResult.status === "error") {
    // Manifest extraction failures during sync are surfaced to the author
    // (they're usually infra hiccups; retrying the save is safe).
    return Result.error(`Failed to analyze the workflow file in the sandbox: ${invocationResult.error.message}`);
  }
  const outcome = invocationResult.data;
  if (outcome.type === "handler-failed") {
    return Result.error(`The workflow file failed to load: ${outcome.error.name}: ${outcome.error.message}`);
  }
  if (outcome.type !== "manifest") {
    return Result.error(`Unexpected manifest extraction outcome "${outcome.type}"`);
  }

  const manifestValidation = validateManifest(outcome.manifest, expectedWorkflowId);
  if (manifestValidation.status === "error") return Result.error(manifestValidation.error);

  const manifestJson: WorkflowManifestJson = {
    workflow_id: outcome.manifest.workflowId,
    triggers: outcome.manifest.triggers.map((t) => t.type === "event" ? { type: "event", event_type: t.eventType } : { type: "schedule", cron: t.cron, timezone: t.timezone }),
    has_run_key: outcome.manifest.hasRunKey,
    on_conflict: outcome.manifest.onConflict,
    uses_stdlib: usesStdlib,
  };

  return Result.ok({
    compiledBundle,
    manifest: manifestJson,
    runtimeEnvVersion,
    sourceHash: computeWorkflowSourceHash(source, runtimeEnvVersion),
  });
}
