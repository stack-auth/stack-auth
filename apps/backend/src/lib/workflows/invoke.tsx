import { executeJavascript } from "@/lib/js-execution";
import { HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";
import { Result } from "@hexclave/shared/dist/utils/results";
import { WorkflowSandboxInput, WorkflowSandboxOutcome } from "./protocol";

// One sandbox invocation of a compiled workflow bundle. The per-invocation
// input rides in a prelude prepended to the stored bundle (rather than env
// vars or engine-specific channels) so the invocation shape is identical
// across Freestyle, Vercel Sandbox, and the local mock. ESM import hoisting
// makes the prelude-then-bundle concatenation safe: the bundle's only real
// imports are the pinned stdlib, which doesn't read our global.

export type WorkflowInvocationFailure = {
  // "invocation-error": the sandbox/js-execution layer failed (engine
  // unreachable, runner crashed, unparseable result).
  // "runtime-error": the invocation succeeded but our runtime harness threw
  // (a platform bug — user-code errors come back as normal outcomes).
  // "timeout": the engine-side backstop timer fired; the sandbox may still
  // be running, which is safe because of the idempotency floor.
  kind: "invocation-error" | "runtime-error" | "timeout",
  message: string,
};

export async function invokeWorkflowSandbox(options: {
  compiledBundle: string,
  input: WorkflowSandboxInput,
  /** Exact-pinned stdlib packages to install in the sandbox (from the version's recorded runtime env, filtered to what the source imports). */
  nodeModules: Record<string, string>,
  /** Engine-side backstop; the authoritative per-step timeout is enforced by the runtime inside the sandbox. */
  timeoutMs: number,
}): Promise<Result<WorkflowSandboxOutcome, WorkflowInvocationFailure>> {
  const prelude = "globalThis.__HEXCLAVE_WORKFLOWS_INPUT__ = " + JSON.stringify(options.input) + ";\n";
  const code = prelude + options.compiledBundle;

  let executeResult;
  try {
    let timer: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), options.timeoutMs);
    });
    try {
      executeResult = await Promise.race([
        executeJavascript(code, {
          nodeModules: options.nodeModules,
          // Step execution is side-effectful; running it twice for a
          // cross-engine comparison would double-fire the effects.
          disableSanityTest: true,
          // The prelude embeds per-run credentials and secrets — never let
          // the raw code reach error reports.
          logSafeCode: `<workflow bundle, ${options.compiledBundle.length} bundle bytes + redacted input prelude, mode ${options.input.mode}>`,
        }),
        timeoutPromise,
      ]);
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    // js-execution already captureError'd engine failures; from the engine's
    // perspective this is a retriable platform failure of the attempt.
    return Result.error({ kind: "invocation-error", message: error instanceof Error ? error.message : String(error) });
  }

  if (executeResult === "timeout") {
    return Result.error({ kind: "timeout", message: `Workflow sandbox invocation exceeded the ${Math.round(options.timeoutMs / 1000)}s engine-side backstop timeout` });
  }
  if (executeResult.status === "error") {
    // The entry harness catches all user-code errors into normal outcomes,
    // so an error envelope here means the harness/runtime itself broke.
    return Result.error({ kind: "runtime-error", message: executeResult.error.message });
  }

  const outcome = executeResult.data as WorkflowSandboxOutcome | null;
  if (outcome == null || typeof outcome !== "object" || typeof (outcome as any).type !== "string") {
    throw new HexclaveAssertionError("Workflow sandbox returned a malformed outcome", { outcome, mode: options.input.mode });
  }
  return Result.ok(outcome);
}
