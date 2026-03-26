import { Command } from "commander";
import { select, input, confirm } from "@inquirer/prompts";
import * as fs from "fs";
import * as path from "path";
import { StackClientApp } from "@stackframe/js";

import { resolveLoginConfig, resolveSessionAuth, DEFAULT_PUBLISHABLE_CLIENT_KEY } from "../lib/auth.js";
import { getInternalUser } from "../lib/app.js";
import { writeConfigValue } from "../lib/config.js";
import { CliError, AuthError } from "../lib/errors.js";
import { isNonInteractiveEnv } from "../lib/interactive.js";
import { createInitPrompt } from "../lib/init-prompt.js";
import { runClaudeAgent } from "../lib/claude-agent.js";

type InitOptions = {
  mode?: "create" | "link-config" | "link-cloud",
  configFile?: string,
  selectProjectId?: string,
  outputDir?: string,
  agent?: boolean,
};

export function registerInitCommand(program: Command) {
  program
    .command("init")
    .description("Initialize Stack Auth in your project")
    .option("--mode <mode>", "Mode: create, link-config, or link-cloud (skips interactive prompts)")
    .option("--config-file <path>", "Path to existing config file (for link-config mode)")
    .option("--select-project-id <id>", "Project ID to link (for link-cloud mode)")
    .option("--output-dir <dir>", "Directory to write output files (defaults to cwd)")
    .option("--no-agent", "Skip Claude agent and print setup instructions instead")
    .action(async (opts: InitOptions) => {
      try {
        await runInit(program, opts);
      } catch (error: unknown) {
        if (error != null && typeof error === "object" && "name" in error && error.name === "ExitPromptError") {
          console.log("\nAborted.");
          process.exit(0);
        }
        throw error;
      }
    });
}

async function runInit(program: Command, opts: InitOptions) {
  const flags = program.opts();
  const outputDir = opts.outputDir ? path.resolve(opts.outputDir) : process.cwd();

  console.log("Welcome to Stack Auth!\n");

  if (!opts.mode && isNonInteractiveEnv()) {
    throw new CliError("Non-interactive environment detected. Pass --mode <create|link-config|link-cloud> to specify the init mode.");
  }

  const mode: string = "link";
  // TODO: re-enable local emulator option
  // const mode: string = opts.mode ?? await select({
  //   message: "Would you like to link to an existing project, or create a new one?",
  //   choices: [
  //     { name: "Create a new project (local emulator)", value: "create" as const },
  //     { name: "Link an existing project", value: "link" as const },
  //   ],
  // });

  let configPath: string | undefined;

  if (mode === "link" || mode === "link-config" || mode === "link-cloud") {
    const result = await handleLink(flags, opts, outputDir);
    configPath = result.configPath;
  } else if (mode === "create") {
    const result = await handleCreate(opts, outputDir);
    configPath = result.configPath;
  } else {
    throw new CliError(`Unknown mode: ${mode}`);
  }

  const initPrompt = createInitPrompt({ web: false, configPath, createGithubAction: mode === "create" });
  const useAgent = opts.agent !== false && !isNonInteractiveEnv();

  if (useAgent) {
    const success = await runClaudeAgent({
      prompt: `Execute ALL of the following setup steps in my project now. Do not ask questions — just detect the framework and package manager from existing files and proceed.\n\n${initPrompt}`,
      cwd: outputDir,
    });
    if (!success) {
      console.log("\nFalling back to manual instructions:\n");
      console.log(initPrompt);
    }
  } else {
    console.log("\n" + initPrompt);
  }
}

async function handleLink(flags: Record<string, unknown>, opts: InitOptions, outputDir: string): Promise<{ configPath?: string }> {
  let source: "config-file" | "cloud";

  if (opts.mode === "link-config") {
    source = "config-file";
  } else if (opts.mode === "link-cloud") {
    source = "cloud";
  } else {
    if (isNonInteractiveEnv()) {
      throw new CliError("Non-interactive environment detected. Use --mode link-config or --mode link-cloud to specify the link source.");
    }
    source = await select({
      message: "How would you like to link your project?",
      choices: [
        { name: "Link from config file", value: "config-file" as const },
        { name: "Link from app.stack-auth.com", value: "cloud" as const },
      ],
    });
  }

  if (source === "config-file") {
    return await handleLinkFromConfigFile(opts);
  }
  return await handleLinkFromCloud(flags, opts, outputDir);
}

async function handleLinkFromConfigFile(opts: InitOptions): Promise<{ configPath: string }> {
  if (!opts.configFile && isNonInteractiveEnv()) {
    throw new CliError("Non-interactive environment detected. Pass --config-file <path> to specify the config file path.");
  }

  const filePath = opts.configFile ?? await input({
    message: "Path to your existing stack.config.ts:",
    validate: (value) => {
      const resolved = path.resolve(value);
      if (!fs.existsSync(resolved)) {
        return `File not found: ${resolved}`;
      }
      return true;
    },
  });

  const configPath = path.resolve(filePath);
  if (!fs.existsSync(configPath)) {
    throw new CliError(`File not found: ${configPath}`);
  }

  console.log(`\nLinked to config file: ${configPath}`);
  return { configPath };
}

async function handleLinkFromCloud(flags: Record<string, unknown>, opts: InitOptions, outputDir: string): Promise<{ configPath?: string }> {
  let sessionAuth;
  try {
    sessionAuth = resolveSessionAuth(flags as { projectId?: string });
  } catch (e) {
    if (e instanceof AuthError) {
      if (isNonInteractiveEnv()) {
        throw new CliError("Not logged in. Run `stack login` first or set STACK_CLI_REFRESH_TOKEN.");
      }
      console.log("You need to log in first.\n");
      await performLogin(flags);
      sessionAuth = resolveSessionAuth(flags as { projectId?: string });
    } else {
      throw e;
    }
  }

  const user = await getInternalUser(sessionAuth);
  const projects = await user.listOwnedProjects();

  if (projects.length === 0) {
    throw new CliError("You don't own any projects. Create one at app.stack-auth.com first.");
  }

  let projectId: string;
  if (opts.selectProjectId) {
    const found = projects.find((p) => p.id === opts.selectProjectId);
    if (!found) {
      throw new CliError(`Project '${opts.selectProjectId}' not found among your owned projects.`);
    }
    projectId = opts.selectProjectId;
  } else {
    if (isNonInteractiveEnv()) {
      throw new CliError("Non-interactive environment detected. Pass --select-project-id <id> to specify which project to link.");
    }
    projectId = await select({
      message: "Select a project:",
      choices: projects.map((p) => ({
        name: `${p.displayName} (${p.id})`,
        value: p.id,
      })),
    });
  }

  const project = projects.find((p) => p.id === projectId)!;
  const apiKey = await project.app.createInternalApiKey({
    description: "Created by CLI init script",
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365 * 200), // 200 years
    hasPublishableClientKey: true,
    hasSecretServerKey: true,
    hasSuperSecretAdminKey: false,
  });

  const envLines = [
    "# Stack Auth",
    `NEXT_PUBLIC_STACK_PROJECT_ID=${projectId}`,
    `NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY=${apiKey.publishableClientKey ?? ""}`,
    `STACK_SECRET_SERVER_KEY=${apiKey.secretServerKey ?? ""}`,
  ].join("\n");

  const envPath = path.resolve(outputDir, ".env");

  if (fs.existsSync(envPath)) {
    const existing = fs.readFileSync(envPath, "utf-8");
    const separator = existing.endsWith("\n") ? "\n" : "\n\n";

    if (isNonInteractiveEnv()) {
      fs.appendFileSync(envPath, separator + envLines + "\n");
      console.log("\nAppended Stack Auth keys to .env");
    } else {
      const shouldAppend = await confirm({
        message: `.env file already exists. Append Stack Auth keys?`,
        default: true,
      });

      if (shouldAppend) {
        fs.appendFileSync(envPath, separator + envLines + "\n");
        console.log("\nAppended Stack Auth keys to .env");
      } else {
        console.log("\nHere are your environment variables:\n");
        console.log(envLines);
      }
    }
  } else {
    fs.writeFileSync(envPath, envLines + "\n");
    console.log("\nCreated .env with Stack Auth keys");
  }

  return {};
}

async function performLogin(flags: Record<string, unknown>) {
  const config = resolveLoginConfig(flags as { projectId?: string });

  const app = new StackClientApp({
    projectId: "internal",
    publishableClientKey: DEFAULT_PUBLISHABLE_CLIENT_KEY,
    baseUrl: config.apiUrl,
    tokenStore: "memory",
    noAutomaticPrefetch: true,
  });

  console.log("Waiting for browser authentication...");

  const result = await app.promptCliLogin({
    appUrl: config.dashboardUrl,
  });

  if (result.status === "error") {
    throw new CliError(`Login failed: ${result.error.message}`);
  }

  writeConfigValue("STACK_CLI_REFRESH_TOKEN", result.data);
  console.log("Login successful!\n");
}

async function handleCreate(opts: InitOptions, outputDir: string): Promise<{ configPath: string }> {
  const configPath = path.resolve(outputDir, "stack.config.ts");

  console.log(`\nCreating a new config file at ${configPath}!\n`);

  const content = `export const config = {};\n`;
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, content);

  console.log(`\nConfig file written to ${configPath}`);
  return { configPath };
}
