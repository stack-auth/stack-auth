import { query } from "@anthropic-ai/claude-agent-sdk";

const DEFAULT_PROXY_URL = "https://api.stack-auth.com/api/v1/integrations/ai-proxy";
const ANTHROPIC_PROXY_BASE_URL: string = process.env.STACK_CLAUDE_PROXY_URL ?? DEFAULT_PROXY_URL;

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

class AgentProgressUI {
  private mainLabel: string;
  private spinnerFrame = 0;
  private spinnerTimer: ReturnType<typeof setInterval> | null = null;
  private activeSpinners = new Map<string, string>(); // id -> label
  private flushedCount = 0; // number of completed items already printed above the spinner area
  private pendingCompleted: string[] = []; // completed items not yet flushed
  private lastLineCount = 0;

  constructor(mainLabel: string) {
    this.mainLabel = mainLabel;
  }

  start() {
    this.spinnerTimer = setInterval(() => {
      this.spinnerFrame = (this.spinnerFrame + 1) % SPINNER_FRAMES.length;
      this.render();
    }, 80);
    this.render();
  }

  stop(success: boolean) {
    if (this.spinnerTimer) {
      clearInterval(this.spinnerTimer);
      this.spinnerTimer = null;
    }
    this.completeAllActive();
    this.clearLines();
    const icon = success ? "\x1b[32m✔\x1b[0m" : "\x1b[31m✖\x1b[0m";
    // Re-print header + all completed items as final output
    console.log(`${icon} ${this.mainLabel}`);
    for (const label of this.pendingCompleted) {
      console.log(`  \x1b[32m✔\x1b[0m ${label}`);
    }
    this.pendingCompleted = [];
  }

  setSpinner(id: string, label: string) {
    this.activeSpinners.set(id, label);
  }

  complete(id: string, label?: string) {
    const existing = this.activeSpinners.get(id);
    this.activeSpinners.delete(id);
    const finalLabel = label ?? existing;
    if (finalLabel) {
      this.pendingCompleted.push(finalLabel);
    }
  }

  completeAllActive() {
    for (const label of this.activeSpinners.values()) {
      this.pendingCompleted.push(label);
    }
    this.activeSpinners.clear();
  }

  private clearLines() {
    if (this.lastLineCount > 0) {
      process.stdout.write(`\x1b[${this.lastLineCount}A\x1b[J`);
    }
  }

  private flushCompleted() {
    if (this.pendingCompleted.length === 0) {
      return;
    }
    // Clear the spinner area, print completed items permanently, then re-render spinner below
    this.clearLines();
    // Re-print the header line if this is the first flush
    if (this.flushedCount === 0) {
      const frame = SPINNER_FRAMES[this.spinnerFrame];
      process.stdout.write(`\x1b[36m${frame}\x1b[0m ${this.mainLabel}\n`);
    }
    for (const label of this.pendingCompleted) {
      process.stdout.write(`  \x1b[32m✔\x1b[0m ${label}\n`);
    }
    this.flushedCount += this.pendingCompleted.length;
    this.pendingCompleted = [];
    this.lastLineCount = 0; // reset since we printed permanent lines
  }

  private render() {
    this.flushCompleted();
    this.clearLines();

    const frame = SPINNER_FRAMES[this.spinnerFrame];
    const lines: string[] = [];

    // Only show header in spinner area if nothing has been flushed yet
    if (this.flushedCount === 0) {
      lines.push(`\x1b[36m${frame}\x1b[0m ${this.mainLabel}`);
    }

    for (const label of this.activeSpinners.values()) {
      lines.push(`  \x1b[36m${frame}\x1b[0m ${label}`);
    }

    if (lines.length > 0) {
      const output = lines.join("\n") + "\n";
      process.stdout.write(output);
    }
    this.lastLineCount = lines.length;
  }
}

function getToolLabel(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case "Read": {
      return `Reading ${input.file_path ?? "file"}`;
    }
    case "Write": {
      return `Writing ${input.file_path ?? "file"}`;
    }
    case "Edit": {
      return `Editing ${input.file_path ?? "file"}`;
    }
    case "Bash": {
      return `Running \`${truncate(String(input.command ?? ""), 40)}\``;
    }
    case "Glob": {
      return `Searching for ${input.pattern ?? "files"}`;
    }
    case "Grep": {
      return `Searching for "${truncate(String(input.pattern ?? ""), 30)}"`;
    }
    default: {
      return toolName;
    }
  }
}

function truncate(str: string, maxLen: number): string {
  return str.length > maxLen ? str.slice(0, maxLen - 1) + "…" : str;
}

function stripClaudeCodeEnv(): Record<string, string> {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  return env as Record<string, string>;
}

export async function runClaudeAgent(options: {
  prompt: string,
  cwd: string,
}): Promise<boolean> {
  const ui = new AgentProgressUI("Setting up Stack Auth...");
  ui.start();

  try {
    let resultText = "";

    for await (const message of query({
      prompt: options.prompt,
      options: {
        allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
        permissionMode: "dontAsk",
        cwd: options.cwd,
        // stripClaudeCodeEnv removes CLAUDECODE env var to prevent nested agent detection. Anthropic api key cannot be empty otherwise users without claude code installed get a login error
        env: { ...stripClaudeCodeEnv(), ANTHROPIC_BASE_URL: ANTHROPIC_PROXY_BASE_URL, ANTHROPIC_API_KEY: "stack-auth-proxy" },
        stderr: (data: string) => { process.stderr.write(data); },
      },
    })) {
      if ("result" in message) {
        resultText = message.result;
      } else if (message.type === "assistant" && message.parent_tool_use_id === null) {
        // New parent assistant turn — previous tools are done
        ui.completeAllActive();
        // Register new tool calls from this turn
        for (const block of message.message.content) {
          if (block.type === "tool_use") {
            ui.setSpinner(block.id, getToolLabel(block.name, block.input as Record<string, unknown>));
          }
        }
      } else if (message.type === "system") {
        // Subagent task lifecycle
        const msg = message as Record<string, unknown>;
        const taskId = msg.task_id as string | undefined;

        if (msg.subtype === "task_started" && taskId) {
          ui.setSpinner(taskId, String(msg.description ?? "Working..."));
        } else if (msg.subtype === "task_progress" && taskId) {
          ui.setSpinner(taskId, String(msg.description ?? "Working..."));
        } else if (msg.subtype === "task_notification" && taskId) {
          ui.complete(taskId, String(msg.summary ?? msg.description ?? "Done"));
        }
      }
    }

    ui.stop(true);
    if (resultText) {
      console.log(`\n${resultText}`);
    }
    return true;
  } catch (error) {
    ui.stop(false);
    console.error("\nClaude agent encountered an error:", error instanceof Error ? error.message : error);
    return false;
  }
}
