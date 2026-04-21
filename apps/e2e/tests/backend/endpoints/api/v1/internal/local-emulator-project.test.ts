import { randomUUID } from "crypto";
import fs from "fs/promises";
import path from "path";
import { describe } from "vitest";
import { it } from "../../../../../helpers";
import { backendContext, niceBackendFetch } from "../../../../backend-helpers";

const LOCAL_EMULATOR_PROJECT_ENDPOINT = "/api/v1/internal/local-emulator/project";
const LOCAL_EMULATOR_OWNER_TEAM_ID = "5a0c858b-d9e9-49d4-9943-8ce385d86428";
const isLocalEmulator = process.env.NEXT_PUBLIC_STACK_IS_LOCAL_EMULATOR === "true";

async function createTempConfigFile(): Promise<string> {
  const filePath = `/tmp/${randomUUID()}/stack.config.ts`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, "export const config = {};\n", "utf-8");
  return filePath;
}

describe("local emulator project endpoint", () => {
  it("returns a clear error when local emulator mode is disabled", async ({ expect }) => {
    if (isLocalEmulator) {
      return;
    }

    const response = await niceBackendFetch(LOCAL_EMULATOR_PROJECT_ENDPOINT, {
      accessType: "admin",
      method: "POST",
      body: {
        absolute_file_path: `/tmp/${randomUUID()}/stack.config.ts`,
      },
    });

    expect(response.status).toBe(400);
    expect(response.body).toContain("NEXT_PUBLIC_STACK_IS_LOCAL_EMULATOR=true");
  });

  it.runIf(isLocalEmulator)("rejects non-absolute paths", async ({ expect }) => {
    for (const nonAbsolutePath of [
      `relative/${randomUUID()}/stack.config.ts`,
      `./relative/${randomUUID()}/stack.config.ts`,
      "",
    ]) {
      const response = await niceBackendFetch(LOCAL_EMULATOR_PROJECT_ENDPOINT, {
        accessType: "admin",
        method: "POST",
        body: {
          absolute_file_path: nonAbsolutePath,
        },
      });

      expect(response.status).toBe(400);
      expect(response.body).toContain("absolute_file_path must be an absolute path");
    }
  });

  it.runIf(isLocalEmulator)("rejects non-existent config files", async ({ expect }) => {
    const nonExistentPath = `/tmp/${randomUUID()}/stack.config.ts`;

    const response = await niceBackendFetch(LOCAL_EMULATOR_PROJECT_ENDPOINT, {
      accessType: "admin",
      method: "POST",
      body: {
        absolute_file_path: nonExistentPath,
      },
    });

    expect(response.status).toBe(400);
    expect(response.body).toContain("Config file not found");
  });

  it.runIf(isLocalEmulator)("writes default config for empty files", async ({ expect }) => {
    const filePath = `/tmp/${randomUUID()}/stack.config.ts`;
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, "", "utf-8");

    const response = await niceBackendFetch(LOCAL_EMULATOR_PROJECT_ENDPOINT, {
      accessType: "admin",
      method: "POST",
      body: {
        absolute_file_path: filePath,
      },
    });

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body.branch_config_override_string)).toEqual({});
    expect(response.body.onboarding_status).toBe("config_choice");
    expect(response.body.onboarding_outstanding).toBe(true);

    const fileContent = await fs.readFile(filePath, "utf-8");
    expect(fileContent).toMatchInlineSnapshot(`
      deindent\`
        import type { StackConfig } from "@stackframe/js";
        
        export const config: StackConfig = "show-onboarding";
      \` + "\\n"
    `);
  });

  it.runIf(isLocalEmulator)("enables onboarding iff config is show-onboarding", async ({ expect }) => {
    const filePath = `/tmp/${randomUUID()}/stack.config.ts`;
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(
      filePath,
      `import type { StackConfig } from "@stackframe/js";\n\nexport const config: StackConfig = "show-onboarding";\n`,
      "utf-8",
    );

    const onboardingResponse = await niceBackendFetch(LOCAL_EMULATOR_PROJECT_ENDPOINT, {
      accessType: "admin",
      method: "POST",
      body: {
        absolute_file_path: filePath,
      },
    });
    expect(onboardingResponse.status).toBe(200);
    expect(onboardingResponse.body.onboarding_status).toBe("config_choice");
    expect(onboardingResponse.body.onboarding_outstanding).toBe(true);

    await fs.writeFile(filePath, `export const config = {};\n`, "utf-8");
    const completedResponse = await niceBackendFetch(LOCAL_EMULATOR_PROJECT_ENDPOINT, {
      accessType: "admin",
      method: "POST",
      body: {
        absolute_file_path: filePath,
      },
    });
    expect(completedResponse.status).toBe(200);
    expect(completedResponse.body.project_id).toBe(onboardingResponse.body.project_id);
    expect(completedResponse.body.onboarding_status).toBe("completed");
    expect(completedResponse.body.onboarding_outstanding).toBe(false);

    await fs.writeFile(
      filePath,
      `import type { StackConfig } from "@stackframe/js";\n\nexport const config: StackConfig = "show-onboarding";\n`,
      "utf-8",
    );
    const onboardingAgainResponse = await niceBackendFetch(LOCAL_EMULATOR_PROJECT_ENDPOINT, {
      accessType: "admin",
      method: "POST",
      body: {
        absolute_file_path: filePath,
      },
    });
    expect(onboardingAgainResponse.status).toBe(200);
    expect(onboardingAgainResponse.body.project_id).toBe(onboardingResponse.body.project_id);
    expect(onboardingAgainResponse.body.onboarding_status).toBe("config_choice");
    expect(onboardingAgainResponse.body.onboarding_outstanding).toBe(true);
  });

  it.runIf(isLocalEmulator)("creates path-based projects, reuses mappings, and returns valid credentials", async ({ expect }) => {
    const pathA = await createTempConfigFile();
    const pathB = await createTempConfigFile();

    const responseA1 = await niceBackendFetch(LOCAL_EMULATOR_PROJECT_ENDPOINT, {
      accessType: "admin",
      method: "POST",
      body: {
        absolute_file_path: pathA,
      },
    });
    expect(responseA1.status).toBe(200);
    expect(responseA1.body.project_id).toEqual(expect.any(String));
    expect(responseA1.body.secret_server_key).toMatch(/^ssk_/);
    expect(responseA1.body.super_secret_admin_key).toMatch(/^sak_/);
    expect(JSON.parse(responseA1.body.branch_config_override_string)).toEqual({});
    expect(responseA1.body.onboarding_status).toBe("completed");
    expect(responseA1.body.onboarding_outstanding).toBe(false);

    const responseA2 = await niceBackendFetch(LOCAL_EMULATOR_PROJECT_ENDPOINT, {
      accessType: "admin",
      method: "POST",
      body: {
        absolute_file_path: pathA,
      },
    });
    expect(responseA2.status).toBe(200);
    expect(responseA2.body.project_id).toBe(responseA1.body.project_id);
    expect(responseA2.body.secret_server_key).toBe(responseA1.body.secret_server_key);
    expect(responseA2.body.super_secret_admin_key).toBe(responseA1.body.super_secret_admin_key);

    const responseB = await niceBackendFetch(LOCAL_EMULATOR_PROJECT_ENDPOINT, {
      accessType: "admin",
      method: "POST",
      body: {
        absolute_file_path: pathB,
      },
    });
    expect(responseB.status).toBe(200);
    expect(responseB.body.project_id).not.toBe(responseA1.body.project_id);
    expect(JSON.parse(responseB.body.branch_config_override_string)).toEqual({});
    expect(responseB.body.onboarding_status).toBe("completed");
    expect(responseB.body.onboarding_outstanding).toBe(false);

    backendContext.set({
      projectKeys: {
        projectId: responseA1.body.project_id,
        superSecretAdminKey: responseA1.body.super_secret_admin_key,
      },
    });
    const projectAResponse = await niceBackendFetch("/api/v1/internal/projects/current", {
      method: "GET",
      accessType: "admin",
    });
    expect(projectAResponse.status).toBe(200);
    expect(projectAResponse.body.owner_team_id).toBe(LOCAL_EMULATOR_OWNER_TEAM_ID);

    backendContext.set({
      projectKeys: {
        projectId: responseB.body.project_id,
        superSecretAdminKey: responseB.body.super_secret_admin_key,
      },
    });
    const projectBResponse = await niceBackendFetch("/api/v1/internal/projects/current", {
      method: "GET",
      accessType: "admin",
    });
    expect(projectBResponse.status).toBe(200);
    expect(projectBResponse.body.owner_team_id).toBe(LOCAL_EMULATOR_OWNER_TEAM_ID);
  });
});
