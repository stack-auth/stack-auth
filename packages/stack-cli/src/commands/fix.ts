import { confirm, input } from "@inquirer/prompts";
import { Command } from "commander";
import { runClaudeAgent } from "../lib/claude-agent.js";
import { CliError } from "../lib/errors.js";
import { isNonInteractiveEnv } from "../lib/interactive.js";

type FixOptions = {
  error?: string,
  outputDir?: string,
  yes?: boolean,
};

const MAX_ERROR_LENGTH = 8000;

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf-8").trim();
}

export function registerFixCommand(program: Command) {
  program
    .command("fix")
    .description("Use an AI agent to fix a Stack Auth error in your project")
    .option("--error <text>", "The error message to fix (also accepts stdin)")
    .option("--output-dir <dir>", "Directory of the project to fix (defaults to cwd)")
    .option("-y, --yes", "Skip the confirmation prompt")
    .action(async (opts: FixOptions) => {
      try {
        await runFix(opts);
      } catch (error: unknown) {
        if (error != null && typeof error === "object" && "name" in error && error.name === "ExitPromptError") {
          console.log("\nAborted.");
          process.exit(0);
        }
        throw error;
      }
    });
}

async function runFix(opts: FixOptions) {
  const outputDir = opts.outputDir ?? process.cwd();

  let errorText = (opts.error ?? "").trim();
  if (!errorText) {
    const piped = await readStdin();
    if (piped) errorText = piped;
  }
  if (!errorText) {
    if (isNonInteractiveEnv()) {
      throw new CliError("No error provided. Pass --error \"...\" or pipe the error to stdin.");
    }
    errorText = (await input({
      message: "Paste the Stack Auth error you want fixed:",
      validate: (v) => v.trim().length > 0 || "Error text is required",
    })).trim();
  }

  if (errorText.length > MAX_ERROR_LENGTH) {
    errorText = errorText.slice(0, MAX_ERROR_LENGTH);
  }

  console.log("\nError to fix:\n");
  console.log("  " + errorText.split("\n").join("\n  "));
  console.log();

  if (!opts.yes && !isNonInteractiveEnv()) {
    console.log(`Working directory: ${outputDir}`);
    const ok = await confirm({
      message: "Run the AI agent to fix this error?",
      default: true,
    });
    if (!ok) {
      console.log("Aborted.");
      return;
    }
  }

  const prompt = buildFixPrompt(errorText);
  const success = await runClaudeAgent({
    prompt,
    cwd: outputDir,
    label: "Fixing Stack Auth error...",
  });

  if (!success) {
    throw new CliError("The AI agent was unable to complete the fix. See the output above for details.");
  }
}

function buildFixPrompt(errorText: string): string {
  return [
    "You are fixing a Stack Auth (https://stack-auth.com, package `@stackframe/*`) integration error in the user's project.",
    "",
    "YOUR JOB: actually apply the fix to the files on disk using the Edit/Write tools. Do not just diagnose and stop. Do not just describe what to do. Make the edits.",
    "",
    "Workflow (do all of these — do not skip steps):",
    "1. Read the files needed to understand the error: package.json, stack.config.ts if present, .env / .env.local, the file(s) referenced in the stack trace, app/layout.* or pages/_app.*, and any handler route (e.g. app/handler/[...stack]/page.tsx).",
    "2. Diagnose the Stack Auth root cause (e.g. missing StackProvider wrapping, missing env vars, wrong handler route path, incorrect stack.config.ts, wrong import from @stackframe/*, missing API keys, missing `stackServerApp` instance, etc.).",
    "3. Apply the minimal fix using Edit/Write. Actually modify the files. If env vars are missing, instruct the user clearly (do not invent secret values).",
    "4. After editing, verify your change by re-reading the affected file(s).",
    "",
    "GUARDRAILS:",
    "- If, after reading the relevant files, the error is clearly NOT caused by Stack Auth, stop and explain why instead of editing.",
    "- No unrelated refactors, formatting changes, dependency upgrades, or cleanup.",
    "- No destructive shell commands (`rm -rf`, `git reset --hard`, force pushes, deleting branches, anything outside the project directory).",
    "- Never print secret values (STACK_SECRET_SERVER_KEY, etc.) — refer to env vars by name only.",
    "",
    "The user pasted the following error:",
    "",
    "<<<ERROR_START>>>",
    errorText,
    "<<<ERROR_END>>>",
    "",
    "FINAL OUTPUT FORMAT — your last assistant message MUST be exactly this markdown structure, with nothing before or after it:",
    "",
    "## Error",
    "<one or two sentence plain-language summary of what went wrong>",
    "",
    "## Files changed",
    "- `path/to/file1` — <one-line description of the change>",
    "- `path/to/file2` — <one-line description of the change>",
    "(If you didn't change any files, write `_None_` here and explain why in the Solution section.)",
    "",
    "## Solution",
    "<2–5 sentences: what the root cause was, what you changed and why, and any follow-up the user must do themselves (e.g. set an env var, restart the dev server).>",
  ].join("\n");
}
