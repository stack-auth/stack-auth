import type { SpawnSyncOptions } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import type { Colorize, JsonRecord } from "./util";
import { getCommandPath, logVerbose, shouldWriteConfigFile } from "./util";

const MCP_SERVER_NAME = "stack-auth";
const MCP_SERVER_URL = "https://mcp.stack-auth.com/";
const MCP_ACCEPT_HEADER = "application/json, text/event-stream";

type JsonUpdater = (current: JsonRecord) => JsonRecord | null | undefined;
type JsonTarget = { path: string, allowCreate?: boolean };

const VS_CODE_PAYLOAD = JSON.stringify({ type: "http", name: MCP_SERVER_NAME, url: MCP_SERVER_URL });
const CLAUDE_BASE_ARGS = ["mcp", "add", "--transport", "http", MCP_SERVER_NAME, MCP_SERVER_URL] as const;
type RunScheduledCommandMetadata = {
  recordInCommandsExecuted?: boolean,
};

type McpSchedulerContext = {
  projectPath: string,
  isDryRun: boolean,
  colorize: Colorize,
  registerWriteHandler: (handler: () => Promise<void>) => void,
  registerCommandHandler: (handler: () => Promise<void>) => void,
  recordFileChange: (fullPath: string, existed: boolean) => Promise<void>,
  runScheduledCommand: (
    command: string,
    args: string[],
    options?: SpawnSyncOptions,
    metadata?: RunScheduledCommandMetadata,
  ) => Promise<void>,
};

export function scheduleMcpConfiguration(ctx: McpSchedulerContext): void {
  const workspaceRoot = path.resolve(ctx.projectPath);
  const homeDir = os.homedir();

  logMcpVerbose("scheduleMcpConfiguration invoked", { workspaceRoot, homeDir });
  scheduleCursorConfigs(ctx, homeDir, workspaceRoot);
  scheduleVsCodeConfigs(ctx, homeDir, workspaceRoot);
  scheduleClaudeConfigs(ctx, workspaceRoot);
  scheduleWindsurfConfigs(ctx, homeDir);
  scheduleGeminiConfig(ctx, homeDir);
}

function scheduleCursorConfigs(ctx: McpSchedulerContext, homeDir: string, workspaceRoot: string): void {
  const updater = createServerUpdater("mcpServers", { url: MCP_SERVER_URL });
  logMcpVerbose("Scheduling Cursor MCP configs", { homeDir, workspaceRoot });
  const targets = [
    { path: path.join(homeDir, ".cursor", "mcp.json"), allowCreate: false, scope: "home" },
    { path: path.join(workspaceRoot, ".cursor", "mcp.json"), allowCreate: true, scope: "workspace" },
  ];
  for (const target of targets) {
    logInvestigationStatus("Cursor", target.path, target.scope);
  }
  scheduleJsonTargets(
    ctx,
    targets.map(({ path: targetPath, allowCreate }) => ({ path: targetPath, allowCreate })),
    updater,
  );
}

function scheduleVsCodeConfigs(ctx: McpSchedulerContext, homeDir: string, workspaceRoot: string): void {
  const updater = createServerUpdater("servers", { type: "http", url: MCP_SERVER_URL });
  const paths = getVsCodeUserConfigPaths(homeDir);

  logMcpVerbose("Scheduling VS Code MCP configs", { homeDir, paths });
  paths.stable.forEach((configPath) => logInvestigationStatus("VS Code (stable)", configPath));
  paths.insiders.forEach((configPath) => logInvestigationStatus("VS Code (insiders)", configPath));
  const workspaceTarget = path.join(workspaceRoot, ".vscode", "mcp.json");
  logInvestigationStatus("VS Code (workspace)", workspaceTarget);
  const stableChanged = scheduleJsonTargets(
    ctx,
    paths.stable.map((configPath) => ({ path: configPath })),
    updater,
  );
  const insidersChanged = scheduleJsonTargets(
    ctx,
    paths.insiders.map((configPath) => ({ path: configPath })),
    updater,
  );
  const workspaceChanged = scheduleJsonTargets(
    ctx,
    [{ path: path.join(workspaceRoot, ".vscode", "mcp.json"), allowCreate: true }],
    updater,
  );

  scheduleCliIfAvailable(ctx, "code", ["--add-mcp", VS_CODE_PAYLOAD], true);
  scheduleCliIfAvailable(ctx, "code-insiders", ["--add-mcp", VS_CODE_PAYLOAD], true);
}

function findClaudeExecutable(): string {
  // Check for local installations first
  // (Claude installs itself via alias so it may not be in the system PATH)
  const homeDir = os.homedir();
  const localBinPath = path.join(homeDir, ".local", "bin", "claude");
  const claudeLocalPath = path.join(homeDir, ".claude", "local", "claude");

  if (fs.existsSync(localBinPath)) {
    return localBinPath;
  }

  if (fs.existsSync(claudeLocalPath)) {
    return claudeLocalPath;
  }

  // Fall back to system PATH
  return "claude";
}

function scheduleClaudeConfigs(ctx: McpSchedulerContext, workspaceRoot: string): void {
  const updater = createServerUpdater("mcpServers", { type: "http", url: MCP_SERVER_URL });
  logMcpVerbose("Scheduling Claude MCP configs", { workspaceRoot });
  const targetPath = path.join(workspaceRoot, ".mcp.json");
  logInvestigationStatus("Claude (project)", targetPath);
  const projectConfigChanged = scheduleJsonTargets(
    ctx,
    [{ path: targetPath, allowCreate: true }],
    updater,
  );

  const claudeExecutable = findClaudeExecutable();
  scheduleCliIfAvailable(ctx, claudeExecutable, [...CLAUDE_BASE_ARGS, "--scope", "user"], projectConfigChanged);
  scheduleCliIfAvailable(
    ctx,
    claudeExecutable,
    [...CLAUDE_BASE_ARGS, "--scope", "project"],
    projectConfigChanged,
    { cwd: workspaceRoot },
  );
}

function scheduleWindsurfConfigs(ctx: McpSchedulerContext, homeDir: string): void {
  const updater = createServerUpdater("mcpServers", { serverUrl: MCP_SERVER_URL });
  logMcpVerbose("Scheduling Windsurf MCP configs", { homeDir });
  const paths = getWindsurfConfigPaths(homeDir);
  paths.forEach((configPath) => logInvestigationStatus("Windsurf", configPath));
  scheduleJsonTargets(ctx, paths.map((configPath) => ({ path: configPath })), updater);
}

function scheduleGeminiConfig(ctx: McpSchedulerContext, homeDir: string): void {
  const updater = createServerUpdater("mcpServers", {
    httpUrl: MCP_SERVER_URL,
    headers: { Accept: MCP_ACCEPT_HEADER },
  });

  logMcpVerbose("Scheduling Gemini MCP configs", { homeDir });
  const targetPath = path.join(homeDir, ".gemini", "settings.json");
  logInvestigationStatus("Gemini", targetPath);
  scheduleJsonTargets(
    ctx,
    [{ path: targetPath }],
    updater,
  );
}

function scheduleJsonFileUpdate(
  ctx: McpSchedulerContext,
  fullPath: string | null | undefined,
  update: JsonUpdater,
  options: { allowCreate?: boolean } = {}
): boolean {
  logMcpVerbose("scheduleJsonFileUpdate invoked", { fullPath, allowCreate: options.allowCreate });
  if (!fullPath) {
    logMcpVerbose("scheduleJsonFileUpdate skipped: no path provided");
    return false;
  }

  const allowCreate = options.allowCreate ?? false;
  if (!shouldWriteConfigFile(fullPath, { allowCreate })) {
    logMcpVerbose("scheduleJsonFileUpdate skipped: shouldWriteConfigFile returned false", { fullPath, allowCreate });
    return false;
  }

  const absolutePath = path.resolve(fullPath);
  const info = readJsonOrEmpty(absolutePath);
  logMcpVerbose("scheduleJsonFileUpdate current file info", { absolutePath, existed: info.existed, parseError: info.parseError?.message });
  const draft = cloneJsonRecord(info.data);
  const updated = update(draft);
  if (!updated) {
    logMcpVerbose("scheduleJsonFileUpdate skipped: updater returned nullish", { absolutePath });
    return false;
  }

  const nextContent = JSON.stringify(updated, null, 2) + "\n";
  const currentContent = info.existed && !info.parseError ? JSON.stringify(info.data, null, 2) + "\n" : null;
  if (!info.parseError && currentContent === nextContent) {
    logMcpVerbose("scheduleJsonFileUpdate skipped: content unchanged", { absolutePath });
    return false;
  }

  ctx.registerWriteHandler(async () => {
    await writeJsonFile(ctx, absolutePath, update, { allowCreate });
  });

  logMcpVerbose("scheduleJsonFileUpdate scheduled write", { absolutePath });
  return true;
}

type WriteJsonOptions = { allowCreate?: boolean };

async function writeJsonFile(
  ctx: McpSchedulerContext,
  absolutePath: string,
  update: JsonUpdater,
  options: WriteJsonOptions
): Promise<void> {
  logMcpVerbose("writeJsonFile invoked", { absolutePath, allowCreate: options.allowCreate });
  const allowCreate = options.allowCreate ?? false;
  const info = readJsonOrEmpty(absolutePath);

  if (!info.existed && !allowCreate) {
    logMcpVerbose("writeJsonFile skipped: file missing and allowCreate false", { absolutePath });
    return;
  }

  let current = info.data;
  if (info.parseError) {
    console.warn(
      ctx.colorize.yellow`Warning: Unable to parse MCP config at ${absolutePath}. It will be replaced with a fresh configuration.`
    );
    current = {};
    logMcpVerbose("writeJsonFile parse error encountered; falling back to empty object", { absolutePath, error: info.parseError.message });
  }

  const draft = cloneJsonRecord(current);
  const updated = update(draft);
  if (!updated) {
    logMcpVerbose("writeJsonFile skipped: updater returned nullish", { absolutePath });
    return;
  }

  const nextContent = JSON.stringify(updated, null, 2) + "\n";
  const currentContent = info.existed && !info.parseError ? JSON.stringify(current, null, 2) + "\n" : null;
  if (currentContent === nextContent && !info.parseError) {
    logMcpVerbose("writeJsonFile skipped: current content matches desired content", { absolutePath });
    return;
  }

  if (ctx.isDryRun) {
    console.log(`[DRY-RUN] Would write ${absolutePath}`);
    logMcpVerbose("writeJsonFile dry-run; write skipped", { absolutePath });
    return;
  }

  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });

  if (info.existed) {
    try {
      fs.copyFileSync(absolutePath, `${absolutePath}.bak`);
    } catch {
      // Ignore backup failures; the write below is still valid.
    }
  }

  fs.writeFileSync(absolutePath, nextContent, "utf-8");
  await ctx.recordFileChange(absolutePath, info.existed);
  logMcpVerbose("writeJsonFile completed write", { absolutePath, existed: info.existed });
}

function scheduleJsonTargets(ctx: McpSchedulerContext, targets: JsonTarget[], update: JsonUpdater): boolean {
  let changed = false;
  logMcpVerbose("scheduleJsonTargets invoked", { targetCount: targets.length });
  for (const target of targets) {
    if (!target.path) continue;
    if (scheduleJsonFileUpdate(ctx, target.path, update, { allowCreate: target.allowCreate })) {
      changed = true;
    }
  }
  logMcpVerbose("scheduleJsonTargets completed", { changed });
  return changed;
}

function scheduleCliIfAvailable(
  ctx: McpSchedulerContext,
  command: string,
  args: string[],
  shouldRun: boolean,
  options?: SpawnSyncOptions,
): void {
  logMcpVerbose("scheduleCliIfAvailable invoked", { command, args, shouldRun });
  if (!shouldRun) {
    logMcpVerbose("scheduleCliIfAvailable skipped: shouldRun false", { command });
    return;
  }
  const commandPath = getCommandPath(command);
  if (!commandPath) {
    logMcpVerbose("scheduleCliIfAvailable skipped: command not available", { command });
    return;
  }
  logMcpVerbose("scheduleCliIfAvailable scheduling CLI registration", { command });
  scheduleCliRegistration(ctx, commandPath, args, options);
}

function createServerUpdater(containerKey: string, entry: JsonRecord): JsonUpdater {
  logMcpVerbose("createServerUpdater invoked", { containerKey });
  return (current: JsonRecord): JsonRecord => {
    const next = { ...current };
    const servers = { ...(next[containerKey] ?? {}) };
    servers[MCP_SERVER_NAME] = cloneJsonRecord(entry);
    next[containerKey] = servers;
    return next;
  };
}

function getVsCodeUserConfigPaths(homeDir: string): { stable: string[], insiders: string[] } {
  const stable = new Set<string>();
  const insiders = new Set<string>();
  const platform = process.platform;

  logMcpVerbose("getVsCodeUserConfigPaths invoked", { homeDir, platform });
  if (platform === "darwin") {
    stable.add(path.join(homeDir, "Library", "Application Support", "Code", "User", "mcp.json"));
    insiders.add(path.join(homeDir, "Library", "Application Support", "Code - Insiders", "User", "mcp.json"));
  } else if (platform === "win32") {
    const appData = process.env.APPDATA;
    if (appData) {
      stable.add(path.join(appData, "Code", "User", "mcp.json"));
      insiders.add(path.join(appData, "Code - Insiders", "User", "mcp.json"));
    }
  } else {
    stable.add(path.join(homeDir, ".config", "Code", "User", "mcp.json"));
    insiders.add(path.join(homeDir, ".config", "Code - Insiders", "User", "mcp.json"));
  }

  return {
    stable: Array.from(stable),
    insiders: Array.from(insiders),
  };
}

function getWindsurfConfigPaths(homeDir: string): string[] {
  const paths = new Set<string>();

  logMcpVerbose("getWindsurfConfigPaths invoked", { homeDir, platform: process.platform });
  if (process.platform === "darwin") {
    paths.add(path.join(homeDir, ".codeium", "windsurf", "mcp_config.json"));
  } else if (process.platform === "win32") {
    const appData = process.env.APPDATA;
    if (appData) {
      paths.add(path.join(appData, "Codeium", "Windsurf", "mcp_config.json"));
    }
  } else {
    paths.add(path.join(homeDir, ".config", "Codeium", "Windsurf", "mcp_config.json"));
    paths.add(path.join(homeDir, ".codeium", "windsurf", "mcp_config.json"));
    paths.add(path.join(homeDir, ".var", "app", "com.codeium.windsurf", "config", "Codeium", "Windsurf", "mcp_config.json"));
  }

  return Array.from(paths);
}

type JsonReadResult = { existed: boolean, data: JsonRecord, parseError: Error | null };

function readJsonOrEmpty(fullPath: string): JsonReadResult {
  logMcpVerbose("readJsonOrEmpty invoked", { fullPath });
  if (!fs.existsSync(fullPath)) {
    logMcpVerbose("readJsonOrEmpty no file found", { fullPath });
    return { existed: false, data: {}, parseError: null };
  }

  try {
    const raw = fs.readFileSync(fullPath, "utf-8");
    const data = raw.trim() ? JSON.parse(raw) : {};
    logMcpVerbose("readJsonOrEmpty parsed file", { fullPath, hasContent: Boolean(raw.trim()) });
    return { existed: true, data, parseError: null };
  } catch (error) {
    const parseError = error instanceof Error ? error : new Error(String(error));
    logMcpVerbose("readJsonOrEmpty parse error", { fullPath, error: parseError.message });
    return { existed: true, data: {}, parseError };
  }
}

function cloneJsonRecord<T extends JsonRecord>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function scheduleCliRegistration(
  ctx: McpSchedulerContext,
  command: string,
  args: string[],
  options: SpawnSyncOptions = {}
): void {
  logMcpVerbose("scheduleCliRegistration invoked", { command, args, options });
  ctx.registerCommandHandler(async () => {
    try {
      await ctx.runScheduledCommand(command, args, options, {
        recordInCommandsExecuted: false,
      });
    } catch (error) {
      logMcpVerbose("scheduleCliRegistration encountered error. Ignoring.", { command, args, options, error: error instanceof Error ? { message: error.message, stack: error.stack } : error });
    }
  });
}

function logMcpVerbose(message: string, details?: unknown): void {
  logVerbose(`[mcp] ${message}`, details);
}

function logInvestigationStatus(editorLabel: string, configPath: string, scope?: string): void {
  const exists = fs.existsSync(configPath);
  logMcpVerbose(`Investigating ${editorLabel} config${scope ? ` (${scope})` : ""}`, { path: configPath, exists });
}
