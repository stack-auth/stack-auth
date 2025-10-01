import { query } from "@anthropic-ai/claude-agent-sdk";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { filterUndefined } from "@stackframe/stack-shared/dist/utils/objects";
import { nicify } from "@stackframe/stack-shared/dist/utils/strings";
import fs from "node:fs/promises";
import path from "node:path";

export const shouldRunMcpTests = !!process.env.STACK_TEST_RUN_MCP_TESTS;

function assertShouldRunMcpTests() {
  if (!shouldRunMcpTests) {
    throw new StackAssertionError("MCP tests are not enabled, but tried to call a function that requires it. Make sure to invoke `.runIf(shouldRunMcpTests)` on your MCP tests");
  }
}

function sanitizeTestName(testName: string): string {
  return testName
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_");
}

export function createLogToFile(testName: string) {
  const sanitizedTestName = sanitizeTestName(testName);
  const logDir = path.join(__dirname, "./logs");
  const logFilePath = path.join(logDir, `${sanitizedTestName}.txt`);

  return async (message: string) => {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${message}\n`;
    await fs.appendFile(logFilePath, logEntry);
  };
}

type InvokeClaudeCodeOptions = {
  prompt: string,
  projectPath: string,
  testName: string,
};

export async function invokeClaudeCode(options: InvokeClaudeCodeOptions): Promise<string> {
  assertShouldRunMcpTests();

  const {
    prompt,
    projectPath,
    testName,
  } = options;
  const mcpServerUrl = "http://localhost:8104/api/internal/mcp";

  const sanitizedTestName = sanitizeTestName(testName);
  const logDir = path.join(__dirname, "./logs");
  const logFilePath = path.join(logDir, `${sanitizedTestName}.txt`);
  await fs.writeFile(logFilePath, "");

  // Ensure log directory exists
  await fs.mkdir(logDir, { recursive: true });

  const logToFile = createLogToFile(testName);

  await logToFile("=== Claude Code SDK Integration Started ===");
  await logToFile(`Working directory: ${projectPath}`);
  await logToFile(`MCP Server URL: ${mcpServerUrl}`);

  try {
    const claudeQuery = query({
      prompt,
      options: {
        cwd: projectPath,
        permissionMode: "bypassPermissions",
        systemPrompt: {
          type: 'preset',
          preset: 'claude_code'
        },
        mcpServers: {
          "stack-mcp": {
            type: "http",
            url: mcpServerUrl
          }
        },
        model: "claude-sonnet-4-5-20250929",
        env: filterUndefined({
          ...process.env,
          // if not available, it will use the default API key (if the user has one)
          ANTHROPIC_API_KEY: process.env.STACK_TEST_ANTHROPIC_API_KEY,
        }),
        allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
        maxTurns: 20
      }
    });

    await logToFile("Claude Code query initiated");
    let messageCount = 0;
    let lastResult = "";

    for await (const message of claudeQuery) {
      messageCount++;
      await logToFile(`Message ${messageCount} - Type: ${message.type}`);
      await logToFile(`${nicify(message)}\n`);
      if (message.type === 'result') {
        if (message.subtype === 'success') {
          lastResult = message.result;
        }
      }
    }

    await logToFile(`Claude Code integration completed - ${messageCount} messages processed`);
    await logToFile(`Final result: ${lastResult}`);
    await logToFile("=== Claude Code SDK Integration Completed ===");

    return lastResult;
  } catch (error) {
    await logToFile(`ERROR: ${error}`);
    if (error instanceof Error) {
      await logToFile(`Error details: ${JSON.stringify({
        name: error.name,
        message: error.message,
        stack: error.stack?.split('\n').slice(0, 5)
      }, null, 2)}`);
    }
    await logToFile("=== Claude Code SDK Integration Failed ===");
    throw error;
  }
}
