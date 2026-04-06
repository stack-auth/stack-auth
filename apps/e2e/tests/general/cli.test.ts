import { execFile } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { StackAdminApp } from "@stackframe/js";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import { describe, beforeAll, afterAll } from "vitest";
import { it, niceFetch, STACK_BACKEND_BASE_URL, STACK_INTERNAL_PROJECT_CLIENT_KEY, STACK_INTERNAL_PROJECT_SERVER_KEY, STACK_INTERNAL_PROJECT_ADMIN_KEY } from "../helpers";

const CLI_BIN = path.resolve("packages/stack-cli/dist/index.js");
const CLI_SRC_BIN = path.resolve("packages/stack-cli/src/index.ts");

function extractConfigObjectString(content: string): string {
  const configMatch = content.match(/export const config:\s*StackConfig\s*=\s*(.+);\s*$/s);
  if (!configMatch) {
    throw new Error(`Could not extract config object from file:\n${content}`);
  }
  return configMatch[1];
}

function runCli(
  args: string[],
  envOverrides?: Record<string, string>,
): Promise<{ stdout: string, stderr: string, exitCode: number | null }> {
  return new Promise((resolve) => {
    execFile("node", [CLI_BIN, ...args], {
      env: { ...baseEnv, ...envOverrides },
      timeout: 30_000,
    }, (error, stdout, stderr) => {
      resolve({
        stdout: stdout.toString(),
        stderr: stderr.toString(),
        exitCode: error ? (error as any).code ?? 1 : 0,
      });
    });
  });
}

let baseEnv: Record<string, string>;
let tmpDir: string;
let configFilePath: string;
let refreshToken: string;

describe("Stack CLI", () => {
  beforeAll(async () => {
    // Check CLI is built
    if (!fs.existsSync(CLI_BIN)) {
      throw new Error("CLI not built. Run `pnpm --filter @stackframe/stack-cli run build` first.");
    }

    // Create temp dir for config file
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "stack-cli-test-"));
    configFilePath = path.join(tmpDir, "credentials.json");

    // Create test user on internal project (auto-creates team)
    const internalApp = new StackAdminApp({
      projectId: "internal",
      baseUrl: STACK_BACKEND_BASE_URL,
      publishableClientKey: STACK_INTERNAL_PROJECT_CLIENT_KEY,
      secretServerKey: STACK_INTERNAL_PROJECT_SERVER_KEY,
      superSecretAdminKey: STACK_INTERNAL_PROJECT_ADMIN_KEY,
      tokenStore: "memory",
      redirectMethod: "none",
    });

    const fakeEmail = `cli-test-${crypto.randomUUID()}@stack-generated.example.com`;
    Result.orThrow(await internalApp.signUpWithCredential({
      email: fakeEmail,
      password: "test-password-123",
      verificationCallbackUrl: "http://localhost:3000",
    }));

    const user = await internalApp.getUser({ or: "throw" });

    // Create a session to get a refresh token
    const sessionRes = await niceFetch(`${STACK_BACKEND_BASE_URL}/api/v1/auth/sessions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-stack-access-type": "server",
        "x-stack-project-id": "internal",
        "x-stack-publishable-client-key": STACK_INTERNAL_PROJECT_CLIENT_KEY,
        "x-stack-secret-server-key": STACK_INTERNAL_PROJECT_SERVER_KEY,
      },
      body: JSON.stringify({
        user_id: user.id,
        expires_in_millis: 1000 * 60 * 60 * 24,
        is_impersonation: false,
      }),
    });

    if (sessionRes.status !== 200) {
      throw new Error(`Failed to create session: ${sessionRes.status} ${JSON.stringify(sessionRes.body)}`);
    }
    refreshToken = sessionRes.body.refresh_token;

    // Set base env for CLI
    baseEnv = {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      STACK_API_URL: STACK_BACKEND_BASE_URL,
      STACK_CLI_REFRESH_TOKEN: refreshToken,
      STACK_CLI_PUBLISHABLE_CLIENT_KEY: STACK_INTERNAL_PROJECT_CLIENT_KEY,
      STACK_CLI_CONFIG_PATH: configFilePath,
      CI: "1",
    };
  }, 120_000);

  afterAll(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it("shows help output", async ({ expect }) => {
    const { stdout, exitCode } = await runCli(["--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Stack Auth CLI");
  });

  it("shows version output", async ({ expect }) => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve("packages/stack-cli/package.json"), "utf-8"));
    const { stdout, exitCode } = await runCli(["--version"]);
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe(pkg.version);
  });

  it("errors when not logged in", async ({ expect }) => {
    const { stderr, exitCode } = await runCli(["project", "list"], {
      STACK_CLI_REFRESH_TOKEN: "",
    });
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Not logged in");
  });

  it("errors when no project ID given", async ({ expect }) => {
    const { stderr, exitCode } = await runCli(["exec", "return 1"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("No project ID");
  });

  it("logout clears config", async ({ expect }) => {
    // Write a fake token to the config file
    fs.writeFileSync(configFilePath, JSON.stringify({ STACK_CLI_REFRESH_TOKEN: "fake-token" }), { mode: 0o600 });

    const { stdout, exitCode } = await runCli(["logout"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Logged out");

    const content = fs.readFileSync(configFilePath, "utf-8");
    expect(content).not.toContain("fake-token");
  });

  let createdProjectId: string;

  it("lists projects as empty JSON array", async ({ expect }) => {
    const { stdout, exitCode } = await runCli(["--json", "project", "list"]);
    expect(exitCode).toBe(0);
    const projects = JSON.parse(stdout);
    expect(Array.isArray(projects)).toBe(true);
  });

  it("creates a project", async ({ expect }) => {
    const { stdout, exitCode } = await runCli(["--json", "project", "create", "--display-name", "CLI Test"]);
    expect(exitCode).toBe(0);
    const project = JSON.parse(stdout);
    expect(project).toHaveProperty("id");
    expect(project).toHaveProperty("displayName");
    expect(project.displayName).toBe("CLI Test");
    createdProjectId = project.id;
  });

  it("lists projects including created one", async ({ expect }) => {
    expect(createdProjectId).toBeDefined();
    const { stdout, exitCode } = await runCli(["--json", "project", "list"]);
    expect(exitCode).toBe(0);
    const projects = JSON.parse(stdout);
    const found = projects.find((p: any) => p.id === createdProjectId);
    expect(found).toBeDefined();
    expect(found.displayName).toBe("CLI Test");
  });

  it("returns basic expression", async ({ expect }) => {
    expect(createdProjectId).toBeDefined();
    const { stdout, exitCode } = await runCli(
      ["exec", "return 1+1"],
      { STACK_PROJECT_ID: createdProjectId },
    );
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("2");
  });

  it("has stackServerApp object available", async ({ expect }) => {
    const { stdout, exitCode } = await runCli(
      ["exec", "return typeof stackServerApp"],
      { STACK_PROJECT_ID: createdProjectId },
    );
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe('"object"');
  });

  it("exec help mentions docs URL", async ({ expect }) => {
    const { stdout, exitCode } = await runCli(["exec", "--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("https://docs.stack-auth.com/docs/sdk");
  });

  it("errors when no javascript is provided", async ({ expect }) => {
    const { stderr, exitCode } = await runCli(["exec"], { STACK_PROJECT_ID: createdProjectId });
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Missing JavaScript argument");
  });

  it("reports syntax error", async ({ expect }) => {
    const { stderr, exitCode } = await runCli(
      ["exec", "return @@invalid"],
      { STACK_PROJECT_ID: createdProjectId },
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Syntax error");
  });

  it("reports runtime error", async ({ expect }) => {
    const { stderr, exitCode } = await runCli(
      ["exec", "throw new Error('boom')"],
      { STACK_PROJECT_ID: createdProjectId },
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("boom");
  });

  it("reports string runtime error", async ({ expect }) => {
    const { stderr, exitCode } = await runCli(
      ["exec", "throw 'boom-string'"],
      { STACK_PROJECT_ID: createdProjectId },
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("boom-string");
  });

  it("reports object runtime error", async ({ expect }) => {
    const { stderr, exitCode } = await runCli(
      ["exec", "throw { code: 123 }"],
      { STACK_PROJECT_ID: createdProjectId },
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain('{"code":123}');
  });

  it("reports undefined variable", async ({ expect }) => {
    const { stderr, exitCode } = await runCli(
      ["exec", "return nonExistentVar"],
      { STACK_PROJECT_ID: createdProjectId },
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("nonExistentVar");
  });

  it("returns undefined for no return value", async ({ expect }) => {
    const { stdout, exitCode } = await runCli(
      ["exec", "const x = 1"],
      { STACK_PROJECT_ID: createdProjectId },
    );
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("");
  });

  it("returns complex object as JSON", async ({ expect }) => {
    const { stdout, exitCode } = await runCli(
      ["exec", "return {a: 1, b: [2, 3]}"],
      { STACK_PROJECT_ID: createdProjectId },
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed).toEqual({ a: 1, b: [2, 3] });
  });

  it("supports async code", async ({ expect }) => {
    const { stdout, exitCode } = await runCli(
      ["exec", "return await Promise.resolve(42)"],
      { STACK_PROJECT_ID: createdProjectId },
    );
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("42");
  });

  let createdUserEmail: string;

  it("can create user with stackServerApp", async ({ expect }) => {
    createdUserEmail = `exec-test-${crypto.randomUUID()}@stack-generated.example.com`;
    const code = `const u = await stackServerApp.createUser({ primaryEmail: "${createdUserEmail}", password: "test123456" }); return { id: u.id, email: u.primaryEmail }`;
    const { stdout, exitCode } = await runCli(
      ["exec", code],
      { STACK_PROJECT_ID: createdProjectId },
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed).toHaveProperty("id");
    expect(parsed.email).toBe(createdUserEmail);
  });

  it("can list users with stackServerApp", async ({ expect }) => {
    expect(createdProjectId).toBeDefined();
    expect(createdUserEmail).toBeDefined();
    const { stdout, exitCode } = await runCli(
      ["exec", "const users = await stackServerApp.listUsers(); return users.length"],
      { STACK_PROJECT_ID: createdProjectId },
    );
    expect(exitCode).toBe(0);
    const count = JSON.parse(stdout);
    expect(count).toBeGreaterThanOrEqual(1);
  });

  let configTsPath: string;

  it("config pull writes a .ts file", async ({ expect }) => {
    configTsPath = path.join(tmpDir, "config.ts");
    const { stdout, exitCode } = await runCli(
      ["config", "pull", "--config-file", configTsPath, "--overwrite"],
      { STACK_PROJECT_ID: createdProjectId },
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Config written to");
    const content = fs.readFileSync(configTsPath, "utf-8");
    expect(content).toContain('import type { StackConfig } from "@stackframe/js";');
    expect(content).toContain("export const config: StackConfig");
  });

  it("config push succeeds", async ({ expect }) => {
    expect(configTsPath).toBeDefined();
    const { stdout, exitCode } = await runCli(
      ["config", "push", "--config-file", configTsPath],
      { STACK_PROJECT_ID: createdProjectId },
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Config pushed successfully");
  });

  it("config pull rejects bad extension", async ({ expect }) => {
    const badPath = path.join(tmpDir, "config.json");
    const { stderr, exitCode } = await runCli(
      ["config", "pull", "--config-file", badPath],
      { STACK_PROJECT_ID: createdProjectId },
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain(".ts extension");
  });

  it("config push rejects array config export", async ({ expect }) => {
    const badConfigPath = path.join(tmpDir, "config-array.ts");
    fs.writeFileSync(badConfigPath, "export const config = [];\n");
    const { stderr, exitCode } = await runCli(
      ["config", "push", "--config-file", badConfigPath],
      { STACK_PROJECT_ID: createdProjectId },
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("plain `config` object");
  });

  it("config pull rejects overwriting an existing file without --overwrite", async ({ expect }) => {
    const existingConfigPath = path.join(tmpDir, "existing-config.ts");
    fs.writeFileSync(existingConfigPath, "existing\n");

    const { stderr, exitCode } = await runCli(
      ["config", "pull", "--config-file", existingConfigPath],
      { STACK_PROJECT_ID: createdProjectId },
    );

    expect(exitCode).toBe(1);
    expect(stderr).toContain("re-run with --overwrite");
  });

  // --- init command tests ---

  // TODO: Re-enable these create-mode tests once init mode handling is finalized.
  // We keep these skipped (instead of todo) so the test logic remains visible and easy to re-enable.
  it.skip("init create writes stack.config.ts with selected apps", async ({ expect }) => {
    const initDir = path.join(tmpDir, "init-create");
    fs.mkdirSync(initDir, { recursive: true });

    const { stdout, exitCode } = await runCli([
      "init", "--mode", "create", "--apps", "authentication,teams", "--output-dir", initDir,
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Config file written to");

    const content = fs.readFileSync(path.join(initDir, "stack.config.ts"), "utf-8");
    expect(content).toContain('import type { StackConfig } from "@stackframe/js";');
    expect(content).toContain("export const config: StackConfig");
    expect(JSON.parse(extractConfigObjectString(content))).toMatchObject({
      apps: {
        installed: {
          authentication: { enabled: true },
          teams: { enabled: true },
        },
      },
    });
  });

  it.skip("init create with single app", async ({ expect }) => {
    const initDir = path.join(tmpDir, "init-create-single");
    fs.mkdirSync(initDir, { recursive: true });

    const { stdout, exitCode } = await runCli([
      "init", "--mode", "create", "--apps", "authentication", "--output-dir", initDir,
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Config file written to");

    const content = fs.readFileSync(path.join(initDir, "stack.config.ts"), "utf-8");
    expect(JSON.parse(extractConfigObjectString(content))).toMatchObject({
      apps: {
        installed: {
          authentication: { enabled: true },
        },
      },
    });
    expect(content).not.toContain('"teams"');
  });

  it("init link-config with valid path", async ({ expect }) => {
    // Create a dummy config file to link to
    const dummyConfig = path.join(tmpDir, "dummy-stack.config.ts");
    fs.writeFileSync(dummyConfig, "export const config = {};\n");

    const { stdout, exitCode } = await runCli([
      "init", "--mode", "link-config", "--config-file", dummyConfig,
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Linked to config file");
    expect(stdout).toContain(dummyConfig);
  });

  it("init link-config with invalid path fails", async ({ expect }) => {
    const { stderr, exitCode } = await runCli([
      "init", "--mode", "link-config", "--config-file", "/nonexistent/stack.config.ts",
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("File not found");
  });

  it("init link-cloud creates .env with API keys", async ({ expect }) => {
    expect(createdProjectId).toBeDefined();

    const initDir = path.join(tmpDir, "init-cloud");
    fs.mkdirSync(initDir, { recursive: true });

    const { stdout, exitCode } = await runCli([
      "init", "--mode", "link-cloud", "--select-project-id", createdProjectId, "--output-dir", initDir,
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Created .env with Stack Auth keys");

    const envContent = fs.readFileSync(path.join(initDir, ".env"), "utf-8");
    expect(envContent).toContain("# Stack Auth");
    expect(envContent).toContain(`NEXT_PUBLIC_STACK_PROJECT_ID=${createdProjectId}`);
    expect(envContent).toContain("NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY=");
    expect(envContent).toContain("STACK_SECRET_SERVER_KEY=");
  });

  it("init link-cloud appends to existing .env", async ({ expect }) => {
    expect(createdProjectId).toBeDefined();

    const initDir = path.join(tmpDir, "init-cloud-append");
    fs.mkdirSync(initDir, { recursive: true });
    fs.writeFileSync(path.join(initDir, ".env"), "EXISTING_VAR=hello\n");

    const { stdout, exitCode } = await runCli([
      "init", "--mode", "link-cloud", "--select-project-id", createdProjectId, "--output-dir", initDir,
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Appended Stack Auth keys to .env");

    const envContent = fs.readFileSync(path.join(initDir, ".env"), "utf-8");
    expect(envContent).toContain("EXISTING_VAR=hello");
    expect(envContent).toContain("# Stack Auth");
    expect(envContent).toContain(`NEXT_PUBLIC_STACK_PROJECT_ID=${createdProjectId}`);
  });

  it("init link-cloud fails with invalid project ID", async ({ expect }) => {
    const { stderr, exitCode } = await runCli([
      "init", "--mode", "link-cloud", "--select-project-id", "nonexistent-project-id",
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("not found");
  });

  it.skip("init outputs setup instructions", async ({ expect }) => {
    const initDir = path.join(tmpDir, "init-instructions");
    fs.mkdirSync(initDir, { recursive: true });

    const { stdout, exitCode } = await runCli([
      "init", "--mode", "create", "--apps", "authentication", "--output-dir", initDir,
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("STACK AUTH SETUP INSTRUCTIONS");
  });
});

// Emulator CLI tests — no backend required, just validates help/arg parsing
describe("Stack CLI — Emulator", () => {
  function runCliBare(
    args: string[],
  ): Promise<{ stdout: string, stderr: string, exitCode: number | null }> {
    return new Promise((resolve) => {
      execFile("node", [CLI_BIN, ...args], {
        env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", CI: "1" },
        timeout: 15_000,
      }, (error, stdout, stderr) => {
        resolve({
          stdout: stdout.toString(),
          stderr: stderr.toString(),
          exitCode: error ? (error as any).code ?? 1 : 0,
        });
      });
    });
  }

  function runCliBareFromSource(
    args: string[],
  ): Promise<{ stdout: string, stderr: string, exitCode: number | null }> {
    return new Promise((resolve) => {
      execFile("node", ["--import", "tsx", CLI_SRC_BIN, ...args], {
        env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", CI: "1" },
        timeout: 15_000,
      }, (error, stdout, stderr) => {
        resolve({
          stdout: stdout.toString(),
          stderr: stderr.toString(),
          exitCode: error ? (error as any).code ?? 1 : 0,
        });
      });
    });
  }

  it("emulator help shows subcommands", async ({ expect }) => {
    const { stdout, exitCode } = await runCliBare(["emulator", "--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("pull");
    expect(stdout).toContain("start");
    expect(stdout).toContain("stop");
    expect(stdout).toContain("reset");
    expect(stdout).toContain("status");
    expect(stdout).toContain("list-releases");
  });

  it("emulator pull help shows options", async ({ expect }) => {
    const { stdout, exitCode } = await runCliBare(["emulator", "pull", "--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("--arch");
    expect(stdout).toContain("--branch");
    expect(stdout).toContain("--tag");
    expect(stdout).toContain("--repo");
  });

  it("emulator pull rejects invalid arch values", async ({ expect }) => {
    const { stderr, exitCode } = await runCliBareFromSource(["emulator", "pull", "--arch", "sparc"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Invalid architecture: sparc. Expected arm64 or amd64.");
  });

  it("emulator list-releases help shows repo option", async ({ expect }) => {
    const { stdout, exitCode } = await runCliBare(["emulator", "list-releases", "--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("--repo");
  });
});
