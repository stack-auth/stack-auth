import { generateSecureRandomString } from "@stackframe/stack-shared/dist/utils/crypto";
import { parseJson } from "@stackframe/stack-shared/dist/utils/json";
import { deindent } from "@stackframe/stack-shared/dist/utils/strings";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach } from "vitest";
import { it, runCommand } from "../helpers";
import { createLogToFile, invokeClaudeCode, shouldRunMcpTests } from "./mcp-helpers";

type ClaudeStackAuthInstallOptions = {
  prompt?: string,
  projectPath: string,
  testName: string,
  projectType?: string,
};

async function installStackAuthWithClaude(options: ClaudeStackAuthInstallOptions): Promise<void> {
  const {
    prompt = deindent`
      Install Stack Auth into this project.

      For the environment variables, you can use:

      Stack API URL (eg. VITE_PUBLIC_STACK_API_URL, NEXT_PUBLIC_STACK_API_URL, STACK_API_URL, etc.): http://localhost:8102
      Stack Project ID: internal
      Stack Publishable Client Key: this-publishable-client-key-is-for-local-development-only
      Stack Secret Server Key: this-secret-server-key-is-for-local-development-only
    `,
    projectPath,
    testName,
  } = options;

  await invokeClaudeCode({
    prompt,
    projectPath,
    testName,
  });

  // Verify Stack Auth installation
  const packageJsonPath = path.join(projectPath, "package.json");
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));

  const logToFile = createLogToFile(testName);

  await logToFile(`Dependencies: ${Object.keys(packageJson.dependencies || {}).join(", ")}`);
  await logToFile(`DevDependencies: ${Object.keys(packageJson.devDependencies || {}).join(", ")}`);
}

declare module "vitest" {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface TestContext {
    mcpTmpdir: string,
  }
}

beforeEach(async (ctx) => {
  const safeName = ctx.task.name.replace(/[^a-zA-Z0-9.-]+/g, "_").slice(0, 64) + "-" + generateSecureRandomString();
  const dir = path.join(os.tmpdir(), "vitest-run", safeName);
  await fs.mkdir(dir, { recursive: true });
  ctx.mcpTmpdir = dir;

  return async () => {
    if (!process.env.STACK_TEST_KEEP_TMPDIR) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  };
});

it("[testing the test harness] test harness writes a file in tmpdir", async ({ mcpTmpdir, expect }) => {
  const file = path.join(mcpTmpdir, "hello.txt");
  await fs.writeFile(file, "hi");
  expect(await fs.readFile(file, "utf8")).toBe("hi");
});

it.runIf(shouldRunMcpTests)("lists the Stack Auth MCP server with Claude Code", async ({ expect, mcpTmpdir, task }) => {
  const result = await invokeClaudeCode({
    prompt: "List the Stack Auth MCP tools available to you. Give the output in a JSON array format of the tool names, prefixed by ###OUTPUT_START### and suffixed by ###OUTPUT_END###",
    projectPath: mcpTmpdir,
    testName: task.name,
  });
  const actualOutput = result.slice(result.indexOf("###OUTPUT_START###") + 18, result.indexOf("###OUTPUT_END###")).trim();
  expect(parseJson(actualOutput)).toMatchInlineSnapshot(`
    {
      "data": [
        "mcp__stack-mcp__list_available_docs",
        "mcp__stack-mcp__get_docs_by_id",
        "mcp__stack-mcp__get_stack_auth_setup_instructions",
      ],
      "status": "ok",
    }
  `);
}, 60_000);


it.runIf(shouldRunMcpTests)("installs Stack Auth into an existing Next.js project with Claude Code", async ({ mcpTmpdir, expect, task }) => {
  // 1. Create new Next.js project
  const { stdout } = await runCommand`cd ${mcpTmpdir} && npx -y create-next-app@latest test-run-output --app --ts --no-src-dir --tailwind --use-npm --eslint --import-alias '##@#/*' --turbopack`;
  expect(stdout).toContain("Success! Created test-run-output");

  // 2. Install Stack Auth into the project
  await installStackAuthWithClaude({
    projectPath: path.join(mcpTmpdir, "test-run-output"),
    testName: task.name,
    projectType: "Next.js"
  });

  // 3. Run the project and see if it works
  // TODO
}, 240_000);
