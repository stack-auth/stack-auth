import { execFile } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { StackAdminApp } from "@stackframe/js";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import { describe, beforeAll, afterAll } from "vitest";
import { it, niceFetch, STACK_BACKEND_BASE_URL, STACK_INTERNAL_PROJECT_CLIENT_KEY, STACK_INTERNAL_PROJECT_SERVER_KEY, STACK_INTERNAL_PROJECT_ADMIN_KEY } from "../helpers";

const CLI_BIN = path.resolve("packages/stack-cli/dist/index.js");

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
    configFilePath = path.join(tmpDir, ".stackrc");

    // Create test user on internal project (auto-creates team)
    const internalApp = new StackAdminApp({
      projectId: "internal",
      baseUrl: STACK_BACKEND_BASE_URL,
      publishableClientKey: STACK_INTERNAL_PROJECT_CLIENT_KEY,
      secretServerKey: STACK_INTERNAL_PROJECT_SERVER_KEY,
      superSecretAdminKey: STACK_INTERNAL_PROJECT_ADMIN_KEY,
      tokenStore: "memory",
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
    fs.writeFileSync(configFilePath, "STACK_CLI_REFRESH_TOKEN=fake-token\n", { mode: 0o600 });

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

  it("lists available exec API methods", async ({ expect }) => {
    const { stdout, exitCode } = await runCli(["exec", "--list-api"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("StackServerApp methods");
    expect(stdout).toContain("StackClientApp methods");
    expect(stdout).toContain("createUser(");
    expect(stdout).toContain("signInWithCredential(");
    expect(stdout).not.toContain("createInternalApiKey(");
  });

  it("errors when combining --list-api and javascript", async ({ expect }) => {
    const { stderr, exitCode } = await runCli(["exec", "--list-api", "return 1"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Cannot pass JavaScript when using --list-api");
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
      ["config", "pull", "--config-file", configTsPath],
      { STACK_PROJECT_ID: createdProjectId },
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Config written to");
    const content = fs.readFileSync(configTsPath, "utf-8");
    expect(content).toContain("export const config");
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
    expect(stderr).toContain(".js or .ts");
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
});
