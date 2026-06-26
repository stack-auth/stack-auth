/**
 * Dashboard -> GitHub config write, full-repo-in-a-sandbox edition.
 *
 * A Claude agent edits the WHOLE repo (config can span files), not just the config
 * file; we skip in-sandbox validation since the linked repo's GitHub Action
 * re-validates on push. Vercel Sandbox can't boot a custom image, so we warm-boot
 * from one SHARED, repo-independent base snapshot (agent runtime only, never a repo
 * or token; build via scripts/config-agent/build-image.ts -> STACK_CONFIG_AGENT_BASE_SNAPSHOT_ID,
 * else cold-boot node24 + install the SDK inline) and take a FRESH shallow clone per write.
 *
 * Token discipline: a fresh token is fetched per boot (GithubTokenProvider),
 * injected only into the git remote URL (never the agent's env), redacted from
 * thrown errors, and never snapshotted — the sandbox is never snapshotted, so the
 * token in `origin` dies with it.
 */

import { buildCompleteConfigAgentPrompt, CONFIG_AGENT_REPO_TOOLS } from "@hexclave/shared-backend/config-agent";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { captureError } from "@hexclave/shared/dist/utils/errors";
import { Sandbox } from "@vercel/sandbox";
import { PRODUCTION_AI_PROXY_BASE_URL } from "../ai/proxy-url";

const AGENT_SDK_VERSION = "0.2.73";
const BASE = "/vercel/sandbox";
const REPO_DIR = `${BASE}/repo`;
const TOOLS_DIR = BASE; // agent SDK + runner live here, separate from the repo
const DEFAULT_AGENT_MODEL = "anthropic/claude-haiku-4.5";
const SANDBOX_TIMEOUT_MS = 900_000;
const REVIEW_SANDBOX_KEEPALIVE_MS = 5 * 60_000;
const GIT_BOT_NAME = "Hexclave Config Bot";
const GIT_BOT_EMAIL = "config-bot@hexclave.com";

export type GithubRepoRef = { owner: string, repo: string, branch: string };

/**
 * Stages reported via `onStage` while a run is `running`. `awaiting_review` is
 * deliberately excluded — it is set separately, outside the staged progress.
 */
export type ConfigAgentInFlightStage = "initializing_sandbox" | "cloning_repo" | "agent_making_changes";

/**
 * Supplies a GitHub token at sandbox-boot time. The orchestrator calls it once
 * per boot (right before the sandbox first touches the repo) instead of
 * capturing a single token for the whole flow, so a long-lived run always picks
 * up the freshest token the caller can produce (the dashboard refetches the
 * user's OAuth token per request).
 */
export type GithubTokenProvider = () => Promise<string>;

export type ConfigUpdateCommitResult = { mode: "commit-to-branch", branch: string, commitUrl: string, commitSha: string };
export const CONFIG_REPO_COMMIT_CONFLICT_SAFE_ERROR = "The GitHub branch changed before the config commit could be pushed. Retry the update to apply the same changes on the latest branch.";

export class ConfigRepoAgentError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ConfigRepoAgentError";
  }
}

export class ConfigRepoCommitConflictError extends ConfigRepoAgentError {
  constructor(options?: { cause?: unknown }) {
    super(CONFIG_REPO_COMMIT_CONFLICT_SAFE_ERROR, options);
    this.name = "ConfigRepoCommitConflictError";
  }
}

export function isGitBranchConflictOutput(output: string): boolean {
  const normalized = output.toLowerCase();
  return normalized.includes("non-fast-forward")
    || normalized.includes("fetch first")
    || normalized.includes("stale info")
    || (normalized.includes("failed to push some refs") && normalized.includes("updates were rejected"));
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

async function getConfigAgentSandbox(sandboxId: string): Promise<Sandbox> {
  const creds = sandboxCreds();
  return await Sandbox.get({ sandboxId, token: creds.token, teamId: creds.teamId, projectId: creds.projectId });
}

async function stopSandboxWithContext(sandboxId: string, context: string): Promise<void> {
  try {
    const sandbox = await getConfigAgentSandbox(sandboxId);
    await sandbox.stop();
  } catch (error) {
    captureError(context, error);
  }
}

async function keepSandboxAliveForReview(sandbox: Sandbox): Promise<void> {
  // The review UI needs the live sandbox because commit runs from the edited
  // working tree. Top it back up to a five-minute review window once the diff is
  // ready instead of relying on whatever time is left after agent execution.
  const timeoutRemainingMs = sandbox.timeout;
  if (timeoutRemainingMs < REVIEW_SANDBOX_KEEPALIVE_MS) {
    await sandbox.extendTimeout(REVIEW_SANDBOX_KEEPALIVE_MS - timeoutRemainingMs);
  }
}

async function reportConfigAgentProgress(onProgress: AgentProgressSink | undefined, progress: string, context: string): Promise<void> {
  if (!onProgress) return;
  try {
    await onProgress(progress);
  } catch (error) {
    captureError(context, error);
  }
}

async function reportConfigAgentStage(
  onStage: ((stage: ConfigAgentInFlightStage) => Promise<void>) | undefined,
  stage: ConfigAgentInFlightStage,
): Promise<void> {
  if (!onStage) return;
  try {
    await onStage(stage);
  } catch (error) {
    captureError("config-repo-agent-stage", error);
  }
}

/**
 * Strip any tokenized remote URL (`https://x-access-token:<token>@github.com/...`)
 * out of a string before it can be thrown, captured, persisted, or logged. The
 * clone command passes the tokenized URL as an argv, and git can echo the remote
 * URL in its errors — without this the dashboard user's OAuth token could leak
 * into the persisted run's `error` or Sentry.
 */
function redactTokens(text: string): string {
  return text.replace(/x-access-token:[^@\s/]+@/g, "x-access-token:***@");
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
    throw new ConfigRepoAgentError(redactTokens(`Command failed (exit ${r.exitCode}): ${cmd} ${args.join(" ")}\n${(r.stderr || r.stdout).slice(-1500)}`));
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
// Agent
// ---------------------------------------------------------------------------

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

// SANITIZED progress only: the tool action + a file BASENAME, never tool inputs,
// file contents, results, or assistant text — so no config secret or token can
// leak. Bash shows only the first two tokens (program + subcommand), so args
// (which could carry a token/secret) are never emitted. Written to a JSON file the
// orchestrator polls (robust across the sandbox boundary; no stdout/encoding deps).
const PROGRESS = ${JSON.stringify(`${TOOLS_DIR}/progress.json`)};
const recent = [];
const base = (p) => (typeof p === "string" ? (p.split("/").pop() || p) : "");
// In-sandbox live-feed cap: each line trimmed to 100 chars, keep last 6. Storage
// cap is separate (see recordConfigAgentRunProgress).
const emit = (s) => { recent.push(String(s).replace(/[\\r\\n]+/g, " ").slice(0, 100)); while (recent.length > 6) recent.shift(); try { writeFileSync(PROGRESS, JSON.stringify(recent)); } catch {} };
const describeTool = (name, inp) => {
  inp = inp || {};
  switch (name) {
    case "Read": return "Reading " + base(inp.file_path);
    case "Edit": case "MultiEdit": return "Editing " + base(inp.file_path);
    case "Write": return "Writing " + base(inp.file_path);
    case "Glob": return "Listing files";
    case "Grep": return "Searching the repo";
    case "Bash": { const c = String(inp.command || "").trim().split(/\\s+/).slice(0, 2).join(" "); return c ? ("Running: " + c) : "Running a command"; }
    default: return name || "Working";
  }
};

const input = JSON.parse(readFileSync(${JSON.stringify(`${TOOLS_DIR}/agent-input.json`)}, "utf-8"));
status({ ok: false, stage: "loaded" });
const { query } = await import("@anthropic-ai/claude-agent-sdk");
let resultText = "", sawResult = false;
for await (const m of query({
  prompt: input.prompt,
  options: {
    model: input.model,
    allowedTools: ${JSON.stringify([...CONFIG_AGENT_REPO_TOOLS])},
    permissionMode: "dontAsk",
    cwd: ${JSON.stringify(REPO_DIR)},
    env: { ...process.env, ANTHROPIC_BASE_URL: input.baseUrl, ANTHROPIC_API_KEY: input.apiKey, CLAUDECODE: "" },
    stderr: (d) => errs.push(String(d)),
  },
})) {
  if (m.type === "assistant" && m.message && Array.isArray(m.message.content)) {
    for (const block of m.message.content) {
      if (block && block.type === "tool_use") emit(describeTool(block.name, block.input));
    }
  }
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
  ]);
  await run(sandbox, "npm", ["install", "--no-save", `@anthropic-ai/claude-agent-sdk@${AGENT_SDK_VERSION}`], { cwd: TOOLS_DIR });
}

/** A sanitized live-activity callback (recent agent actions joined by newlines). */
export type AgentProgressSink = (activity: string) => Promise<void>;

const PROGRESS_POLL_MS = 1500;

/**
 * Polls the runner's `progress.json` (last few sanitized tool actions) while the
 * detached command runs and forwards changes to `onProgress`. File-based rather
 * than stdout-streamed so it's robust across the sandbox boundary (the same
 * `readFileToBuffer` path used for `status.json`). `redactTokens` is a 2nd layer.
 */
async function pollAgentProgress(
  sandbox: Sandbox,
  command: { wait: () => Promise<unknown> },
  onProgress: AgentProgressSink,
): Promise<void> {
  let finished = false;
  const markFinished = () => {
    finished = true;
  };
  const waiter = command.wait().then(markFinished, markFinished);
  let last = "";
  const readOnce = async () => {
    const buf = await sandbox.readFileToBuffer({ path: `${TOOLS_DIR}/progress.json` }).catch(() => null);
    if (!buf) return;
    let lines: unknown;
    try {
      lines = JSON.parse(buf.toString());
    } catch {
      return;
    }
    if (!Array.isArray(lines)) return;
    const text = redactTokens(lines.map((l) => String(l)).join("\n")).trim();
    if (text && text !== last) {
      last = text;
      await reportConfigAgentProgress(onProgress, text, "config-repo-agent-progress-record");
    }
  };
  while (!finished) {
    await Promise.race([waiter, new Promise((r) => setTimeout(r, PROGRESS_POLL_MS))]);
    await readOnce();
  }
  await readOnce(); // capture the final state
}

async function runAgent(sandbox: Sandbox, prompt: string, onProgress?: AgentProgressSink): Promise<void> {
  const agentInput = {
    prompt,
    model: getEnvVariable("STACK_CONFIG_AGENT_MODEL", DEFAULT_AGENT_MODEL),
    baseUrl: getEnvVariable("STACK_CLAUDE_PROXY_URL", PRODUCTION_AI_PROXY_BASE_URL),
    apiKey: "stack-auth-proxy",
  };
  // Write runner.mjs fresh each run (not baked into the base snapshot) so changes
  // here take effect immediately instead of being frozen into an old base image.
  await sandbox.writeFiles([
    { path: `${TOOLS_DIR}/runner.mjs`, content: Buffer.from(buildRunnerScript(), "utf-8") },
    { path: `${TOOLS_DIR}/agent-input.json`, content: Buffer.from(JSON.stringify(agentInput), "utf-8") },
  ]);
  // Run detached so we can poll the runner's progress file while it works; status
  // is read from status.json afterwards (the exit code isn't authoritative here).
  const command = await sandbox.runCommand({ cmd: "node", args: [`${TOOLS_DIR}/runner.mjs`], detached: true });
  if (onProgress) {
    await pollAgentProgress(sandbox, command, onProgress).catch((e) => captureError("config-repo-agent-progress", e));
  } else {
    await command.wait().catch(() => {});
  }
  const statusBuf = await sandbox.readFileToBuffer({ path: `${TOOLS_DIR}/status.json` }).catch(() => null);
  const status = statusBuf ? JSON.parse(statusBuf.toString()) : null;
  if (!status?.ok) {
    const detail = status?.error != null ? redactTokens(String(status.error)) : status?.error;
    captureError("config-repo-agent", new ConfigRepoAgentError("Sandbox agent did not complete", { cause: { error: detail, stage: status?.stage } }));
    throw new ConfigRepoAgentError("The config agent could not apply the changes inside the sandbox.");
  }
}

// ---------------------------------------------------------------------------
// Sandbox boot
// ---------------------------------------------------------------------------

async function gitHead(sandbox: Sandbox): Promise<string> {
  return (await run(sandbox, "git", ["-C", REPO_DIR, "rev-parse", "HEAD"])).stdout.trim();
}

async function assertRemoteBranchStillAtClonedHead(sandbox: Sandbox, githubToken: string, ref: GithubRepoRef): Promise<void> {
  const clonedHead = await gitHead(sandbox);
  await run(sandbox, "git", [
    "-C",
    REPO_DIR,
    "fetch",
    "--depth",
    "1",
    tokenUrl(githubToken, ref),
    `+refs/heads/${ref.branch}:refs/remotes/origin/${ref.branch}`,
  ]);
  const remoteHead = (await run(sandbox, "git", ["-C", REPO_DIR, "rev-parse", `refs/remotes/origin/${ref.branch}`])).stdout.trim();
  if (remoteHead !== clonedHead) {
    throw new ConfigRepoCommitConflictError();
  }
}

/**
 * Boots a config-agent sandbox with the agent SDK available. If a prebuilt base
 * snapshot is configured (`STACK_CONFIG_AGENT_BASE_SNAPSHOT_ID`) the SDK is already
 * baked in and we warm-boot from it; otherwise we cold-boot a node24 sandbox and
 * install the SDK inline (slower — used locally / before the image is built).
 * The returned sandbox has NO repo cloned yet (the caller clones fresh).
 */
async function bootAgentSandbox(creds: SandboxCreds): Promise<Sandbox> {
  const baseSnapshotId = getEnvVariable("STACK_CONFIG_AGENT_BASE_SNAPSHOT_ID", "");
  if (baseSnapshotId) {
    const sandbox = await Sandbox.create({
      source: { type: "snapshot", snapshotId: baseSnapshotId },
      resources: { vcpus: 4 },
      timeout: SANDBOX_TIMEOUT_MS,
      teamId: creds.teamId,
      projectId: creds.projectId,
      token: creds.token,
    });
    // Snapshot boots can ship an empty CA bundle; rebuild it before any HTTPS git.
    await ensureTls(sandbox);
    return sandbox;
  }
  const sandbox = await Sandbox.create({
    resources: { vcpus: 4 },
    timeout: SANDBOX_TIMEOUT_MS,
    runtime: "node24",
    teamId: creds.teamId,
    projectId: creds.projectId,
    token: creds.token,
  });
  await installAgentSdk(sandbox);
  return sandbox;
}

// ---------------------------------------------------------------------------
// Base snapshot build (one-off, via scripts/config-agent/build-image.ts)
// ---------------------------------------------------------------------------

/**
 * Builds the shared, repo-independent base snapshot: a node24 sandbox with the
 * Claude Agent SDK + git bot identity baked in. Reused (read-only) by every config
 * update via `STACK_CONFIG_AGENT_BASE_SNAPSHOT_ID`. This is the closest thing Vercel
 * Sandbox has to a custom image — it contains NO repo and NO token. Run the build
 * script, then set the printed id as the env var.
 */
export async function buildConfigAgentBaseSnapshot(onProgress?: (msg: string) => void): Promise<{ snapshotId: string }> {
  const creds = sandboxCreds();
  const step = (m: string) => onProgress?.(m);
  step("Starting a sandbox…");
  const sandbox = await Sandbox.create({
    resources: { vcpus: 4 },
    timeout: SANDBOX_TIMEOUT_MS,
    runtime: "node24",
    teamId: creds.teamId,
    projectId: creds.projectId,
    token: creds.token,
  });
  try {
    step("Configuring git…");
    await run(sandbox, "git", ["config", "--global", "user.email", GIT_BOT_EMAIL]);
    await run(sandbox, "git", ["config", "--global", "user.name", GIT_BOT_NAME]);
    step("Installing the config agent SDK…");
    await installAgentSdk(sandbox);
    step("Creating the snapshot…");
    const snap = await sandbox.snapshot();
    step("Snapshot ready.");
    return { snapshotId: snap.snapshotId };
  } finally {
    // `snapshot()` already stops the sandbox; this is a best-effort safety net.
    await sandbox.stop().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Apply update (on save)
// ---------------------------------------------------------------------------

/**
 * The result of `applyConfigUpdate`. When the agent found and edited the config
 * file, the sandbox is left alive (status `awaiting_review`) and the caller is
 * responsible for either calling `commitConfigUpdate` or `stopConfigAgentSandbox`.
 */
export type ConfigUpdateApplyResult =
  | {
    mode: "awaiting_review",
    sandboxId: string,
    /** Unified git diff of the agent's changes; never contains secrets. */
    diff: string,
  }
  | { mode: "no-change" };

export async function applyConfigUpdate(options: {
  getGithubToken: GithubTokenProvider,
  ref: GithubRepoRef,
  completeConfig: Record<string, unknown>,
  onSandboxId?: (sandboxId: string) => Promise<void>,
  onStage?: (stage: ConfigAgentInFlightStage) => Promise<void>,
  onProgress?: AgentProgressSink,
}): Promise<ConfigUpdateApplyResult> {
  const { getGithubToken, ref, completeConfig, onSandboxId, onStage, onProgress } = options;
  const creds = sandboxCreds();
  const step = async (msg: string) => {
    await reportConfigAgentProgress(onProgress, msg, "config-repo-agent-step-record");
  };
  const githubToken = await getGithubToken(); // fresh token for this boot

  await reportConfigAgentStage(onStage, "initializing_sandbox");
  await step("Initializing the sandbox…");
  const sandbox = await bootAgentSandbox(creds);
  // Do NOT stop the sandbox in a finally block — when changes are found, we leave
  // it alive for the user to review and commit. The caller must stop it.
  await onSandboxId?.(sandbox.sandboxId);
  // Configure the bot identity for the commit (idempotent; cheap on a warm boot).
  await run(sandbox, "git", ["config", "--global", "user.email", GIT_BOT_EMAIL]);
  await run(sandbox, "git", ["config", "--global", "user.name", GIT_BOT_NAME]);

  // Fresh shallow clone of just the target branch. The tokenized URL is used
  // only for the clone; immediately after, we reset `origin` to a tokenless URL
  // so the agent (which has Bash access) cannot read the token from `.git/config`
  // or `git remote -v`. The token is re-injected only for our own push command.
  await reportConfigAgentStage(onStage, "cloning_repo");
  await step(`Cloning ${ref.owner}/${ref.repo}@${ref.branch}…`);
  await run(sandbox, "git", ["clone", "--depth", "1", "--single-branch", "--branch", ref.branch, tokenUrl(githubToken, ref), REPO_DIR]);
  await run(sandbox, "git", ["-C", REPO_DIR, "remote", "set-url", "origin", tokenlessUrl(ref)]);

  // Agent writes the COMPLETE config to the file — no dependency install, no
  // typecheck (the linked repo's CI validates the committed change).
  await reportConfigAgentStage(onStage, "agent_making_changes");
  await step("Agent editing config…");
  await runAgent(sandbox, buildCompleteConfigAgentPrompt({
    scope: { mode: "repo" },
    completeConfig,
    commandPolicy: "Do NOT install dependencies, run builds, or run a type check. The repository's own CI validates the change after we push, and dependencies are intentionally not installed in this sandbox.",
  }), onProgress);

  const dirty = (await runRaw(sandbox, "git", ["-C", REPO_DIR, "status", "--porcelain"])).stdout.trim();
  if (dirty === "") {
    // No changes — stop the sandbox immediately (nothing to review).
    await stopSandboxWithContext(sandbox.sandboxId, "config-repo-agent-no-change-stop");
    return { mode: "no-change" };
  }

  // Capture the pre-staging diff for review, sanitized like every other sandbox-exit string.
  const diff = redactTokens(
    (await runRaw(sandbox, "git", ["-C", REPO_DIR, "diff"])).stdout,
  );

  await keepSandboxAliveForReview(sandbox);
  // Leave the sandbox alive — the user must confirm before we commit+push.
  return { mode: "awaiting_review", sandboxId: sandbox.sandboxId, diff };
}

/**
 * Commits and pushes the agent's already-applied changes from an existing sandbox
 * that is currently in `awaiting_review` state. The sandbox is stopped afterwards.
 * The GitHub token is obtained freshly — the user may have been reviewing for a
 * while so we don't reuse the token from the original `applyConfigUpdate` call.
 */
export async function commitConfigUpdate(options: {
  sandboxId: string,
  getGithubToken: GithubTokenProvider,
  ref: GithubRepoRef,
  commitMessage: string,
}): Promise<ConfigUpdateCommitResult> {
  const { sandboxId, ref, commitMessage } = options;
  const githubToken = await options.getGithubToken();
  const sandbox = await getConfigAgentSandbox(sandboxId);
  try {
    await assertRemoteBranchStillAtClonedHead(sandbox, githubToken, ref);
    await run(sandbox, "git", ["-C", REPO_DIR, "add", "-A"]);
    await run(sandbox, "git", ["-C", REPO_DIR, "commit", "-m", commitMessage]);
    const commitSha = await gitHead(sandbox);
    // Re-inject the token for the push only.
    try {
      await run(sandbox, "git", ["-C", REPO_DIR, "push", tokenUrl(githubToken, ref), `HEAD:refs/heads/${ref.branch}`]);
    } catch (error) {
      if (isGitBranchConflictOutput(error instanceof Error ? error.message : String(error))) {
        throw new ConfigRepoCommitConflictError({ cause: error });
      }
      throw error;
    }
    return { mode: "commit-to-branch", branch: ref.branch, commitUrl: `https://github.com/${ref.owner}/${ref.repo}/commit/${commitSha}`, commitSha };
  } finally {
    await stopSandboxWithContext(sandboxId, "config-repo-agent-commit-stop");
  }
}

// ---------------------------------------------------------------------------
// Cancel (hard-stop an in-flight run; no revert)
// ---------------------------------------------------------------------------

/**
 * Hard-stops an in-flight run's sandbox by id (called from the cancel route, a
 * different invocation than the one running the agent). Best-effort: a sandbox
 * that already finished/stopped just no-ops. If the agent hadn't pushed yet, this
 * undoes the change; if a commit already landed, it stays (no revert).
 */
export async function stopConfigAgentSandbox(sandboxId: string): Promise<void> {
  await stopSandboxWithContext(sandboxId, "config-repo-agent-cancel-stop");
}
