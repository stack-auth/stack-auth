import { runHeadlessClaudeAgent } from "@hexclave/shared-backend/config-agent";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

type ToolUseBlock = {
  type: "tool_use",
  id: string,
  name: string,
  input: Record<string, unknown>,
};

type TopLevelAssistantMessage = {
  type: "assistant",
  parent_tool_use_id: null,
  message: {
    content: unknown[],
  },
};

type SystemMessage = {
  type: "system",
  subtype?: string,
  task_id?: unknown,
  description?: unknown,
  summary?: unknown,
};

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
    this.clearLines();
    if (this.flushedCount === 0) {
      const frame = SPINNER_FRAMES[this.spinnerFrame];
      process.stdout.write(`\x1b[36m${frame}\x1b[0m ${this.mainLabel}\n`);
    }
    for (const label of this.pendingCompleted) {
      process.stdout.write(`  \x1b[32m✔\x1b[0m ${label}\n`);
    }
    this.flushedCount += this.pendingCompleted.length;
    this.pendingCompleted = [];
    this.lastLineCount = 0;
  }

  private render() {
    this.flushCompleted();
    this.clearLines();

    const frame = SPINNER_FRAMES[this.spinnerFrame];
    const lines: string[] = [];

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

function isTopLevelAssistantMessage(message: unknown): message is TopLevelAssistantMessage {
  return typeof message === "object"
    && message !== null
    && "type" in message
    && message.type === "assistant"
    && "parent_tool_use_id" in message
    && message.parent_tool_use_id === null
    && "message" in message
    && typeof message.message === "object"
    && message.message !== null
    && "content" in message.message
    && Array.isArray(message.message.content);
}

function isSystemMessage(message: unknown): message is SystemMessage {
  return typeof message === "object" && message !== null && "type" in message && message.type === "system";
}

function isToolUseBlock(block: unknown): block is ToolUseBlock {
  return typeof block === "object"
    && block !== null
    && "type" in block
    && block.type === "tool_use"
    && "id" in block
    && "name" in block
    && "input" in block
    && typeof block.id === "string"
    && typeof block.name === "string"
    && typeof block.input === "object"
    && block.input !== null;
}

export async function runClaudeAgent(options: {
  prompt: string,
  cwd: string,
  label?: string,
}): Promise<boolean> {
  const ui = new AgentProgressUI(options.label ?? "Setting up Hexclave...");
  ui.start();

  try {
    const result = await runHeadlessClaudeAgent({
      prompt: options.prompt,
      cwd: options.cwd,
      allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
      stderr: (data: string) => { process.stderr.write(data); },
      onMessage: (message) => {
        if (isTopLevelAssistantMessage(message)) {
          ui.completeAllActive();
          for (const block of message.message.content) {
            if (isToolUseBlock(block)) {
              ui.setSpinner(block.id, getToolLabel(block.name, block.input));
            }
          }
        } else if (isSystemMessage(message)) {
          const taskId = typeof message.task_id === "string" ? message.task_id : undefined;

          if (message.subtype === "task_started" && taskId) {
            ui.setSpinner(taskId, String(message.description ?? "Working..."));
          } else if (message.subtype === "task_progress" && taskId) {
            ui.setSpinner(taskId, String(message.description ?? "Working..."));
          } else if (message.subtype === "task_notification" && taskId) {
            ui.complete(taskId, String(message.summary ?? message.description ?? "Done"));
          }
        }
      },
    });

    ui.stop(true);
    if (result.resultText) {
      console.log(`\n${result.resultText}`);
    }
    return true;
  } catch (error) {
    ui.stop(false);
    console.error("\nClaude agent encountered an error:", error instanceof Error ? error.message : error);
    return false;
  }
}
