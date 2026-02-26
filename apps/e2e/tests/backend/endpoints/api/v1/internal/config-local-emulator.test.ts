import { randomUUID } from "crypto";
import { describe } from "vitest";
import { it } from "../../../../../helpers";
import { backendContext, niceBackendFetch } from "../../../../backend-helpers";

const isLocalEmulator = process.env.NEXT_PUBLIC_STACK_IS_LOCAL_EMULATOR === "true";
const blockedMessage = "cannot be changed in the local emulator";
const localEmulatorProjectEndpoint = "/api/v1/internal/local-emulator/project";

async function switchToLocalEmulatorProject() {
  const response = await niceBackendFetch(localEmulatorProjectEndpoint, {
    method: "POST",
    accessType: "admin",
    body: {
      absolute_file_path: `/tmp/${randomUUID()}/stack.config.ts`,
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
    await switchToLocalEmulatorProject();

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
  });
});
