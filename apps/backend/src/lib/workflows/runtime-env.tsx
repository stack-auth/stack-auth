import { throwErr } from "@hexclave/shared/dist/utils/errors";

// The workflow runtime environment = the platform-provided code a workflow
// executes against that is OUTSIDE its source hash: the in-sandbox runtime
// shim plus the pinned stdlib. It affects workflow behavior, so it is
// explicitly versioned; every WorkflowVersion records the runtime env it was
// synced against, and pinned runs execute against their recorded env.
// Bumping the env NEVER changes existing versions — it only applies to
// versions synced after the bump. (This is the same failure class as the
// email-rendering tailwind caret-drift incident; exact pins only.)

export type WorkflowsRuntimeEnv = {
  // Installed into the sandbox via nodeModules; MUST be exact versions.
  // Only packages the workflow source actually imports are installed (the
  // manifest records usage), so unused pins cost nothing per invocation.
  stdlibNodeModules: Record<string, string>,
};

export const WORKFLOWS_CURRENT_RUNTIME_ENV_VERSION = "2026-07-20.1";

const WORKFLOWS_RUNTIME_ENVS = new Map<string, WorkflowsRuntimeEnv>([
  [WORKFLOWS_CURRENT_RUNTIME_ENV_VERSION, {
    stdlibNodeModules: {
      "date-fns": "4.1.0",
    },
  }],
]);

export function getWorkflowsRuntimeEnv(version: string): WorkflowsRuntimeEnv {
  return WORKFLOWS_RUNTIME_ENVS.get(version) ?? throwErr(`Unknown workflows runtime env version: ${version}. Env versions are append-only and must never be deleted from WORKFLOWS_RUNTIME_ENVS, because old workflow versions pin to them forever.`);
}
