/**
 * Dashboard -> GitHub config write, full-repo-in-a-snapshotted-sandbox edition.
 *
 * Config integration can span many files, so we give a Claude agent the WHOLE
 * repo to edit (not just the config file). To keep that lean, the heavy prep
 * (clone + dependency install + agent SDK install) happens ONCE per linked
 * branch and is captured in a Vercel Sandbox snapshot; each update warm-boots
 * from that snapshot in ~0.3s with node_modules intact.
 *
 * Two phases:
 *   prepareConfigRepoSnapshot  — on link: clone, install, typecheck, snapshot.
 *   applyConfigUpdateInSnapshot — on save: warm-boot, pull, agent edits + checks,
 *                                  commit + push to the base branch, refresh the snapshot.
 *
 * Token discipline: cloned with a token, but the remote is reset to a tokenless
 * URL before snapshotting so the token is never baked into a snapshot. The token
 * is injected only on the orchestrator's own `git pull`/`push` commands and is
 * NEVER placed in the agent's environment — the agent gets Bash to run the
 * project's typecheck and self-correct, but cannot reach the credential.
 */

import type { EnvironmentConfigOverrideOverride } from "@hexclave/shared/dist/config/schema";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { captureError } from "@hexclave/shared/dist/utils/errors";
import { Sandbox, Snapshot } from "@vercel/sandbox";

const AGENT_SDK_VERSION = "0.2.73";
const BASE = "/vercel/sandbox";
const REPO_DIR = `${BASE}/repo`;
const TOOLS_DIR = BASE; // agent SDK + runner live here, separate from the repo
const DEFAULT_AGENT_MODEL = "anthropic/claude-haiku-4.5";
const DEFAULT_PROXY_URL = "https://api.hexclave.com/api/latest/integrations/ai-proxy";
const SANDBOX_TIMEOUT_MS = 900_000;
const GIT_BOT_NAME = "Hexclave Config Bot";
const GIT_BOT_EMAIL = "config-bot@hexclave.com";

export type GithubRepoRef = { owner: string, repo: string, branch: string };

/** Persisted (keyed by projectId+branchId) so each update warm-boots. */
export type ConfigRepoSnapshot = { snapshotId: string, baseCommitSha: string };

export type ConfigUpdatePushResult =
  | { mode: "commit-to-branch", branch: string, commitUrl: string }
  | { mode: "no-change" };

export class ConfigRepoAgentError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ConfigRepoAgentError";
  }
}

// ---------------------------------------------------------------------------
// Sandbox credentials + low-level command helpers
// ---------------------------------------------------------------------------

type SandboxCreds = { teamId?: string, projectId?: string, token: string };

function sandboxCreds(): SandboxCreds {
  const token = getEnvVariable("STACK_VERCEL_SANDBOX_TOKEN", "");
  if (!token || token === "vercel_sandbox_disabled_for_local_development") {
    throw new ConfigRepoAgentError("Vercel Sandbox is not configured (STACK_VERCEL_SANDBOX_TOKEN); the config agent cannot run.");
  }
  return {
    teamId: getEnvVariable("STACK_VERCEL_SANDBOX_TEAM_ID", "") || undefined,
    projectId: getEnvVariable("STACK_VERCEL_SANDBOX_PROJECT_ID", "") || undefined,
    token,
  };
}

type RunResult = { exitCode: number, stdout: string, stderr: string };

async function runRaw(sandbox: Sandbox, cmd: string, args: string[], opts?: { cwd?: string, env?: Record<string, string>, sudo?: boolean }): Promise<RunResult> {
  const finished = await sandbox.runCommand({ cmd, args, ...opts });
  const [stdout, stderr] = await Promise.all([
    finished.stdout().catch(() => ""),
    finished.stderr().catch(() => ""),
  ]);
  return { exitCode: finished.exitCode, stdout, stderr };
}

async function run(sandbox: Sandbox, cmd: string, args: string[], opts?: { cwd?: string, env?: Record<string, string>, sudo?: boolean }): Promise<RunResult> {
  const r = await runRaw(sandbox, cmd, args, opts);
  if (r.exitCode !== 0) {
    throw new ConfigRepoAgentError(`Command failed (exit ${r.exitCode}): ${cmd} ${args.join(" ")}\n${(r.stderr || r.stdout).slice(-1500)}`);
  }
  return r;
}

/**
 * Booting from a snapshot can leave `/etc/ssl/certs/ca-certificates.crt` empty,
 * which makes git/openssl fail with "error adding trust anchors" on any HTTPS
 * remote. Rebuilding the bundle from the (snapshot-captured) CA material fixes
 * it and needs no network. Best-effort — ignore failures on images without it.
 */
async function ensureTls(sandbox: Sandbox): Promise<void> {
  await runRaw(sandbox, "update-ca-certificates", [], { sudo: true });
}

// ---------------------------------------------------------------------------
// Git URLs (token injected only at call time, never persisted)
// ---------------------------------------------------------------------------

function tokenUrl(token: string, ref: Pick<GithubRepoRef, "owner" | "repo">): string {
  return `https://x-access-token:${token}@github.com/${ref.owner}/${ref.repo}.git`;
}
function tokenlessUrl(ref: Pick<GithubRepoRef, "owner" | "repo">): string {
  return `https://github.com/${ref.owner}/${ref.repo}.git`;
}

// ---------------------------------------------------------------------------
// Stack detection
// ---------------------------------------------------------------------------

async function detectPackageManager(sandbox: Sandbox): Promise<"pnpm" | "yarn" | "bun" | "npm"> {
  const lockfiles: Array<[string, "pnpm" | "yarn" | "bun" | "npm"]> = [
    ["pnpm-lock.yaml", "pnpm"], ["yarn.lock", "yarn"], ["bun.lockb", "bun"], ["package-lock.json", "npm"],
  ];
  for (const [file, pm] of lockfiles) {
    if ((await runRaw(sandbox, "test", ["-f", `${REPO_DIR}/${file}`])).exitCode === 0) return pm;
  }
  return "npm";
}

/** Returns the args for the project's "is this still valid" check, or null. */
async function detectCheckCommand(sandbox: Sandbox, pm: string): Promise<{ cmd: string, args: string[] } | null> {
  const pkgRaw = await runRaw(sandbox, "cat", [`${REPO_DIR}/package.json`]);
  let scripts: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(pkgRaw.stdout || "{}");
    if (parsed && typeof parsed === "object" && parsed.scripts && typeof parsed.scripts === "object") {
      scripts = parsed.scripts as Record<string, unknown>;
    }
  } catch {
    // fall through to tsconfig probe
  }
  if (typeof scripts.typecheck === "string") return { cmd: pm, args: ["run", "typecheck"] };
  if (typeof scripts.build === "string") return { cmd: pm, args: ["run", "build"] };
  if ((await runRaw(sandbox, "test", ["-f", `${REPO_DIR}/tsconfig.json`])).exitCode === 0) {
    return { cmd: "npx", args: ["--yes", "tsc", "--noEmit"] };
  }
  return null;
}

async function installDeps(sandbox: Sandbox, pm: string): Promise<void> {
  if (pm !== "npm") await run(sandbox, "corepack", ["enable"], { sudo: true });
  await run(sandbox, pm, ["install"], { cwd: REPO_DIR });
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

function flattenOverride(update: EnvironmentConfigOverrideOverride): Array<{ path: string, value: unknown }> {
  return Object.entries(update as Record<string, unknown>).map(([path, value]) => ({ path, value }));
}

function buildAgentPrompt(update: EnvironmentConfigOverrideOverride, checkHint: string | null): string {
  const changeLines = flattenOverride(update).map(({ path, value }) => `- ${JSON.stringify(path)}: set to ${JSON.stringify(value)}`).join("\n");
  const checkLine = checkHint
    ? `After editing, run \`${checkHint}\` and fix any errors your changes introduced. Re-run it until it passes.`
    : `There is no type/build check configured; make minimal, correct edits.`;
  return `You are updating the Hexclave / Stack Auth configuration for this repository (your current working directory is the repo root). A dashboard user changed some settings and we need the repo's config to match.

The config integration may span multiple files (a \`*.config.ts\` that exports \`config\`, possibly a \`defineHexclaveConfig(...)\` wrapper, helper modules, imported templates, etc.). Find where the config lives and apply these changes. Paths use dot notation, so "a.b.c" refers to config.a.b.c:

${changeLines}

Rules:
- Apply EXACTLY the changes above. Preserve the file's authoring: imports, comments, helper wrappers, and formatting.
- If a value is sourced from an imported external file, update that file rather than inlining the value.
- If the config currently exports the placeholder string "show-onboarding", replace it with a real config object containing these values.
- ${checkLine}
- Do not change unrelated configuration, dependencies, or application code.`;
}

/** Runner executed INSIDE the sandbox (no token in its env). Reads input from a
 * file and persists status to a file; process handlers catch the SDK's async errors. */
function buildRunnerScript(): string {
  return `
import { writeFileSync, readFileSync } from "fs";
const STATUS = ${JSON.stringify(`${TOOLS_DIR}/status.json`)};
const errs = [];
const status = (o) => { try { writeFileSync(STATUS, JSON.stringify({ ...o, stderr: errs.join("").slice(-4000) })); } catch {} };
process.on("uncaughtException", (e) => { status({ ok: false, error: "uncaught:" + String((e && e.stack) || e) }); process.exit(1); });
process.on("unhandledRejection", (e) => { status({ ok: false, error: "unhandledRejection:" + String((e && e.stack) || e) }); process.exit(1); });

const input = JSON.parse(readFileSync(${JSON.stringify(`${TOOLS_DIR}/agent-input.json`)}, "utf-8"));
status({ ok: false, stage: "loaded" });
const { query } = await import("@anthropic-ai/claude-agent-sdk");
let resultText = "", sawResult = false;
for await (const m of query({
  prompt: input.prompt,
  options: {
    model: input.model,
    allowedTools: ["Read", "Edit", "Write", "Glob", "Grep", "Bash"],
    permissionMode: "dontAsk",
    cwd: ${JSON.stringify(REPO_DIR)},
    env: { ...process.env, ANTHROPIC_BASE_URL: input.baseUrl, ANTHROPIC_API_KEY: input.apiKey, CLAUDECODE: "" },
    stderr: (d) => errs.push(String(d)),
  },
})) {
  if (m.type === "result") {
    if ("result" in m) { sawResult = true; resultText = m.result; }
    else { status({ ok: false, error: "agent-failure:" + m.subtype }); process.exit(0); }
  }
}
status({ ok: sawResult, resultText });
`;
}

async function installAgentSdk(sandbox: Sandbox): Promise<void> {
  await sandbox.writeFiles([
    { path: `${TOOLS_DIR}/package.json`, content: Buffer.from(JSON.stringify({ name: "config-agent-tools", private: true, type: "module" }), "utf-8") },
    { path: `${TOOLS_DIR}/runner.mjs`, content: Buffer.from(buildRunnerScript(), "utf-8") },
  ]);
  await run(sandbox, "npm", ["install", "--no-save", `@anthropic-ai/claude-agent-sdk@${AGENT_SDK_VERSION}`], { cwd: TOOLS_DIR });
}

async function runAgent(sandbox: Sandbox, update: EnvironmentConfigOverrideOverride, checkHint: string | null): Promise<void> {
  const agentInput = {
    prompt: buildAgentPrompt(update, checkHint),
    model: getEnvVariable("STACK_CONFIG_AGENT_MODEL", DEFAULT_AGENT_MODEL),
    baseUrl: getEnvVariable("STACK_CLAUDE_PROXY_URL", DEFAULT_PROXY_URL),
    apiKey: "stack-auth-proxy",
  };
  await sandbox.writeFiles([
    { path: `${TOOLS_DIR}/agent-input.json`, content: Buffer.from(JSON.stringify(agentInput), "utf-8") },
  ]);
  await runRaw(sandbox, "node", [`${TOOLS_DIR}/runner.mjs`]); // status read separately
  const statusBuf = await sandbox.readFileToBuffer({ path: `${TOOLS_DIR}/status.json` }).catch(() => null);
  const status = statusBuf ? JSON.parse(statusBuf.toString()) : null;
  if (!status?.ok) {
    captureError("config-repo-agent", new ConfigRepoAgentError("Sandbox agent did not complete", { cause: { error: status?.error, stage: status?.stage } }));
    throw new ConfigRepoAgentError("The config agent could not apply the changes inside the sandbox.");
  }
}

// ---------------------------------------------------------------------------
// Snapshot helpers
// ---------------------------------------------------------------------------

async function snapshotSandbox(sandbox: Sandbox): Promise<string> {
  const snap = await sandbox.snapshot();
  return snap.snapshotId;
}

async function deleteSnapshot(creds: SandboxCreds, snapshotId: string): Promise<void> {
  try {
    const snap = await Snapshot.get({ snapshotId, token: creds.token, teamId: creds.teamId, projectId: creds.projectId });
    await snap.delete();
  } catch (error) {
    captureError("config-repo-agent-snapshot-cleanup", error);
  }
}

async function gitHead(sandbox: Sandbox): Promise<string> {
  return (await run(sandbox, "git", ["-C", REPO_DIR, "rev-parse", "HEAD"])).stdout.trim();
}

// ---------------------------------------------------------------------------
// Phase 1: snapshot agent (on config link)
// ---------------------------------------------------------------------------

export async function prepareConfigRepoSnapshot(options: { githubToken: string, ref: GithubRepoRef }): Promise<ConfigRepoSnapshot> {
  const { githubToken, ref } = options;
  const creds = sandboxCreds();
  const sandbox = await Sandbox.create({
    resources: { vcpus: 4 },
    timeout: SANDBOX_TIMEOUT_MS,
    runtime: "node24",
    teamId: creds.teamId,
    projectId: creds.projectId,
    token: creds.token,
  });
  try {
    await run(sandbox, "git", ["clone", "--depth", "1", "--single-branch", "--branch", ref.branch, tokenUrl(githubToken, ref), REPO_DIR]);
    await run(sandbox, "git", ["-C", REPO_DIR, "remote", "set-url", "origin", tokenlessUrl(ref)]);
    const baseCommitSha = await gitHead(sandbox);

    const pm = await detectPackageManager(sandbox);
    await installDeps(sandbox, pm);
    await installAgentSdk(sandbox);

    const check = await detectCheckCommand(sandbox, pm);
    if (check) await runRaw(sandbox, check.cmd, check.args, { cwd: REPO_DIR }); // best-effort warm + sanity

    const snapshotId = await snapshotSandbox(sandbox);
    return { snapshotId, baseCommitSha };
  } finally {
    await sandbox.stop().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Phase 2: update agent (on save)
// ---------------------------------------------------------------------------

export async function applyConfigUpdateInSnapshot(options: {
  githubToken: string,
  ref: GithubRepoRef,
  snapshot: ConfigRepoSnapshot,
  configUpdate: EnvironmentConfigOverrideOverride,
  commitMessage?: string,
}): Promise<{ result: ConfigUpdatePushResult, snapshot: ConfigRepoSnapshot }> {
  const { githubToken, ref, configUpdate } = options;
  const creds = sandboxCreds();
  const commitMessage = options.commitMessage?.trim() || "chore(hexclave): update config from dashboard";

  const sandbox = await Sandbox.create({
    source: { type: "snapshot", snapshotId: options.snapshot.snapshotId },
    resources: { vcpus: 4 },
    timeout: SANDBOX_TIMEOUT_MS,
    teamId: creds.teamId,
    projectId: creds.projectId,
    token: creds.token,
  });

  let result: ConfigUpdatePushResult;
  let newSnapshot: ConfigRepoSnapshot;
  try {
    await ensureTls(sandbox);
    // Pull the latest base branch (token injected, not persisted).
    await run(sandbox, "git", ["-C", REPO_DIR, "checkout", ref.branch]);
    await run(sandbox, "git", ["-C", REPO_DIR, "pull", tokenUrl(githubToken, ref), ref.branch]);
    await run(sandbox, "git", ["-C", REPO_DIR, "config", "user.email", GIT_BOT_EMAIL]);
    await run(sandbox, "git", ["-C", REPO_DIR, "config", "user.name", GIT_BOT_NAME]);

    const pm = await detectPackageManager(sandbox);
    const check = await detectCheckCommand(sandbox, pm);
    const checkHint = check ? `${check.cmd} ${check.args.join(" ")}` : null;

    await runAgent(sandbox, configUpdate, checkHint);

    // Deterministic gate: re-run the check ourselves; never push a broken config.
    if (check) {
      const verify = await runRaw(sandbox, check.cmd, check.args, { cwd: REPO_DIR });
      if (verify.exitCode !== 0) {
        throw new ConfigRepoAgentError(`The repo's check (${checkHint}) failed after the agent's edits, so nothing was pushed.\n${(verify.stderr || verify.stdout).slice(-1200)}`);
      }
    }

    const dirty = (await runRaw(sandbox, "git", ["-C", REPO_DIR, "status", "--porcelain"])).stdout.trim();
    if (dirty === "") {
      result = { mode: "no-change" };
    } else {
      await run(sandbox, "git", ["-C", REPO_DIR, "add", "-A"]);
      await run(sandbox, "git", ["-C", REPO_DIR, "commit", "-m", commitMessage]);
      const commitSha = await gitHead(sandbox);
      await run(sandbox, "git", ["-C", REPO_DIR, "push", tokenUrl(githubToken, ref), `HEAD:refs/heads/${ref.branch}`]);
      result = { mode: "commit-to-branch", branch: ref.branch, commitUrl: `https://github.com/${ref.owner}/${ref.repo}/commit/${commitSha}` };
    }

    // Refresh the snapshot from a clean base for the next update.
    await run(sandbox, "git", ["-C", REPO_DIR, "checkout", ref.branch]);
    await run(sandbox, "git", ["-C", REPO_DIR, "fetch", tokenUrl(githubToken, ref), ref.branch]);
    await run(sandbox, "git", ["-C", REPO_DIR, "reset", "--hard", "FETCH_HEAD"]);
    const baseCommitSha = await gitHead(sandbox);
    const snapshotId = await snapshotSandbox(sandbox);
    newSnapshot = { snapshotId, baseCommitSha };
  } finally {
    await sandbox.stop().catch(() => {});
  }

  // Drop the stale snapshot only after the fresh one is safely created.
  await deleteSnapshot(creds, options.snapshot.snapshotId);
  return { result, snapshot: newSnapshot };
}
