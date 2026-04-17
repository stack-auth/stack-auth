import { randomUUID } from "crypto";
import fs from "fs/promises";
import path from "path";
import { describe } from "vitest";
import { it } from "../../../../../helpers";
import { backendContext, niceBackendFetch } from "../../../../backend-helpers";

const isLocalEmulator = process.env.NEXT_PUBLIC_STACK_IS_LOCAL_EMULATOR === "true";
const blockedMessage = "cannot be changed in the local emulator";
const localEmulatorProjectEndpoint = "/api/v1/internal/local-emulator/project";

async function switchToLocalEmulatorProject() {
  const filePath = `/tmp/${randomUUID()}/stack.config.ts`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, "export const config = {};\n", "utf-8");

  const response = await niceBackendFetch(localEmulatorProjectEndpoint, {
    method: "POST",
    accessType: "admin",
    body: {
      absolute_file_path: filePath,
    },
  });
  if (response.status !== 200) {
    throw new Error(`Failed to provision local emulator project for config test. Status: ${response.status}, body: ${JSON.stringify(response.body)}`);
  }
  backendContext.set({
    projectKeys: {
      projectId: response.body.project_id,
      superSecretAdminKey: response.body.super_secret_admin_key,
    },
  });
  return filePath;
}

describe("local emulator config restrictions", () => {
  it.runIf(isLocalEmulator)("keeps environment overrides enabled for non-local-emulator projects", async ({ expect }) => {
    const response = await niceBackendFetch("/api/v1/internal/config/override/environment", {
      method: "PATCH",
      accessType: "admin",
      body: {
        config_override_string: JSON.stringify({}),
      },
    });

    expect(response.status).toBe(200);
    expect(response.body).toStrictEqual({ success: true });
  });

  it.runIf(isLocalEmulator)("rejects environment PATCH config overrides", async ({ expect }) => {
    await switchToLocalEmulatorProject();

    const response = await niceBackendFetch("/api/v1/internal/config/override/environment", {
      method: "PATCH",
      accessType: "admin",
      body: {
        config_override_string: JSON.stringify({
          "teams.allowClientTeamCreation": true,
        }),
      },
    });

    expect(response.status).toBe(400);
    expect(response.body).toContain(blockedMessage);
  });

  it.runIf(isLocalEmulator)("rejects environment PUT config overrides", async ({ expect }) => {
    await switchToLocalEmulatorProject();

    const response = await niceBackendFetch("/api/v1/internal/config/override/environment", {
      method: "PUT",
      accessType: "admin",
      body: {
        config_string: JSON.stringify({
          "teams.allowClientTeamCreation": true,
        }),
      },
    });

    expect(response.status).toBe(400);
    expect(response.body).toContain(blockedMessage);
  });

  it.runIf(isLocalEmulator)("rejects resetting environment override keys", async ({ expect }) => {
    await switchToLocalEmulatorProject();

    const response = await niceBackendFetch("/api/v1/internal/config/override/environment/reset-keys", {
      method: "POST",
      accessType: "admin",
      body: {
        keys: ["teams.allowClientTeamCreation"],
      },
    });

    expect(response.status).toBe(400);
    expect(response.body).toContain(blockedMessage);
  });

  it.runIf(isLocalEmulator)("keeps branch override updates enabled", async ({ expect }) => {
    const filePath = await switchToLocalEmulatorProject();

    const response = await niceBackendFetch("/api/v1/internal/config/override/branch", {
      method: "PATCH",
      accessType: "admin",
      body: {
        config_override_string: JSON.stringify({
          "teams.allowClientTeamCreation": true,
        }),
      },
    });

    expect(response.status).toBe(200);
    expect(response.body).toStrictEqual({ success: true });

    const fileContent = await fs.readFile(filePath, "utf-8");
    expect(fileContent).toMatchInlineSnapshot(`
      deindent\`
        import type { StackConfig } from "@stackframe/js";
        
        export const config: StackConfig = {
          "teams": {
            "allowClientTeamCreation": true
          }
        };
      \` + "\\n"
    `);
  });
});
