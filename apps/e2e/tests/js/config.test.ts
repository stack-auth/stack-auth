import { pick } from "@stackframe/stack-shared/dist/utils/objects";
import { describe } from "vitest";
import { it } from "../helpers";
import { createApp } from "./js-helpers";


describe("access control", () => {
  it("serverApp project does not have config methods", async ({ expect }) => {
    const { serverApp } = await createApp();
    const project = await serverApp.getProject();

    // Server apps only get basic Project type, not AdminProject
    // So config methods should not exist
    expect((project as any).updateConfig).toBeUndefined();
    expect((project as any).pushConfig).toBeUndefined();
    expect((project as any).updatePushedConfig).toBeUndefined();
    expect((project as any).getConfig).toBeUndefined();
  });

  it("clientApp project does not have config methods", async ({ expect }) => {
    const { clientApp } = await createApp();
    const project = await clientApp.getProject();

    // Client apps only get basic Project type, not AdminProject
    // So config methods should not exist
    expect((project as any).updateConfig).toBeUndefined();
    expect((project as any).pushConfig).toBeUndefined();
    expect((project as any).updatePushedConfig).toBeUndefined();
    expect((project as any).getConfig).toBeUndefined();
  });

  it("only adminApp project has config methods", async ({ expect }) => {
    const { adminApp } = await createApp();
    const project = await adminApp.getProject();

    // AdminApp gets AdminProject which has config methods
    expect(typeof project.updateConfig).toBe('function');
    expect(typeof project.pushConfig).toBe('function');
    expect(typeof project.updatePushedConfig).toBe('function');
    expect(typeof project.getConfig).toBe('function');
  });
});


describe("error handling", () => {
  it("updateConfig rejects non-existent config fields", async ({ expect }) => {
    const { adminApp } = await createApp();
    const project = await adminApp.getProject();

    await expect(project.updateConfig({
      'nonExistentField.value': true,
    } as any)).rejects.toThrow(/nonExistentField/);
  });

  it("pushConfig rejects non-existent config fields", async ({ expect }) => {
    const { adminApp } = await createApp();
    const project = await adminApp.getProject();

    await expect(project.pushConfig({
      'nonExistentField.value': true,
    } as any)).rejects.toThrow(/nonExistentField/);
  });

  it("updateConfig rejects invalid oauth provider type", async ({ expect }) => {
    const { adminApp } = await createApp();
    const project = await adminApp.getProject();

    await expect(project.updateConfig({
      'auth.oauth.providers.invalid': {
        type: 'not-a-real-provider',
        isShared: false,
        clientId: 'test',
        clientSecret: 'test',
        allowSignIn: true,
        allowConnectedAccounts: true,
      },
    } as any)).rejects.toThrow(/type must be one of the following values/);
  });

  it("pushConfig rejects environment-only fields at branch level", async ({ expect }) => {
    const { adminApp } = await createApp();
    const project = await adminApp.getProject();

    // pushConfig uses branch level, which doesn't allow environment-only fields
    // like clientId, clientSecret, isShared
    await expect(project.pushConfig({
      'auth.oauth.providers.google': {
        type: 'google',
        isShared: false,
        clientId: 'test-client-id',
        clientSecret: 'test-secret',
        allowSignIn: true,
        allowConnectedAccounts: true,
      },
    } as any)).rejects.toThrow(/auth\.oauth\.providers/);
  });

  it("pushConfig allows branch-level oauth fields", async ({ expect }) => {
    const { adminApp } = await createApp();
    const project = await adminApp.getProject();

    // Branch-level fields only (no secrets)
    await project.pushConfig({
      'auth.oauth.providers.my_provider': {
        type: 'google',
        allowSignIn: true,
        allowConnectedAccounts: true,
      },
    } as any);

    const config = await project.getConfig();
    expect(config.auth.oauth.providers['my_provider']).toBeDefined();
  });
});


describe("getConfig", () => {
  it("gets config", async ({ expect }) => {
    const { adminApp } = await createApp();
    const project = await adminApp.getProject();
    const config = await project.getConfig();
    expect(pick(config, ["auth", "users", "teams"])).toMatchInlineSnapshot(`
      {
        "auth": {
          "allowSignUp": true,
          "oauth": {
            "accountMergeStrategy": "link_method",
            "providers": {},
          },
          "otp": { "allowSignIn": false },
          "passkey": { "allowSignIn": false },
          "password": { "allowSignIn": true },
        },
        "teams": {
          "allowClientTeamCreation": false,
          "createPersonalTeamOnSignUp": false,
        },
        "users": { "allowClientUserDeletion": false },
      }
    `);
  });
});


describe("updateConfig", () => {
  it("updates config at environment level", async ({ expect }) => {
    const { adminApp } = await createApp();
    const project = await adminApp.getProject();
    const config = await project.getConfig();
    expect(config['auth']).toMatchInlineSnapshot(`
      {
        "allowSignUp": true,
        "oauth": {
          "accountMergeStrategy": "link_method",
          "providers": {},
        },
        "otp": { "allowSignIn": false },
        "passkey": { "allowSignIn": false },
        "password": { "allowSignIn": true },
      }
    `);

    await project.updateConfig({
      'auth.allowSignUp': false,
    });

    const config2 = await project.getConfig();
    expect(config2['auth']).toMatchInlineSnapshot(`
      {
        "allowSignUp": false,
        "oauth": {
          "accountMergeStrategy": "link_method",
          "providers": {},
        },
        "otp": { "allowSignIn": false },
        "passkey": { "allowSignIn": false },
        "password": { "allowSignIn": true },
      }
    `);
  });

  it("updateConfig merges with existing config", async ({ expect }) => {
    const { adminApp } = await createApp();
    const project = await adminApp.getProject();

    // Set first value
    await project.updateConfig({
      'teams.allowClientTeamCreation': true,
    });

    // Set second value
    await project.updateConfig({
      'users.allowClientUserDeletion': true,
    });

    // Both should be set
    const config = await project.getConfig();
    expect(config.teams.allowClientTeamCreation).toBe(true);
    expect(config.users.allowClientUserDeletion).toBe(true);
  });
});


describe("pushConfig", () => {
  it("pushConfig sets branch-level config", async ({ expect }) => {
    const { adminApp } = await createApp();
    const project = await adminApp.getProject();

    // Push config
    await project.pushConfig({
      'teams.allowClientTeamCreation': true,
      'teams.createPersonalTeamOnSignUp': true,
    });

    // Verify config is applied
    const config = await project.getConfig();
    expect(config.teams.allowClientTeamCreation).toBe(true);
    expect(config.teams.createPersonalTeamOnSignUp).toBe(true);
  });

  it("pushConfig replaces previous pushConfig", async ({ expect }) => {
    const { adminApp } = await createApp();
    const project = await adminApp.getProject();

    // Push first config
    await project.pushConfig({
      'teams.allowClientTeamCreation': true,
      'teams.createPersonalTeamOnSignUp': true,
    });

    // Verify first config is applied
    let config = await project.getConfig();
    expect(config.teams.allowClientTeamCreation).toBe(true);
    expect(config.teams.createPersonalTeamOnSignUp).toBe(true);

    // Push second config (completely replaces first)
    await project.pushConfig({
      'auth.passkey.allowSignIn': true,
    });

    // Verify old values are gone (back to defaults) and new value is set
    config = await project.getConfig();
    expect(config.teams.allowClientTeamCreation).toBe(false); // back to default
    expect(config.teams.createPersonalTeamOnSignUp).toBe(false); // back to default
    expect(config.auth.passkey.allowSignIn).toBe(true); // new value
  });

  it("updateConfig takes precedence over pushConfig", async ({ expect }) => {
    const { adminApp } = await createApp();
    const project = await adminApp.getProject();

    // Push config first
    await project.pushConfig({
      'teams.allowClientTeamCreation': true,
    });

    // Verify push is applied
    let config = await project.getConfig();
    expect(config.teams.allowClientTeamCreation).toBe(true);

    // updateConfig overrides the same value
    await project.updateConfig({
      'teams.allowClientTeamCreation': false,
    });

    // Environment-level (updateConfig) takes precedence
    config = await project.getConfig();
    expect(config.teams.allowClientTeamCreation).toBe(false);
  });

  it("pushConfig does not affect updateConfig values", async ({ expect }) => {
    const { adminApp } = await createApp();
    const project = await adminApp.getProject();

    // updateConfig sets environment-level value
    await project.updateConfig({
      'users.allowClientUserDeletion': true,
    });

    // pushConfig sets branch-level values
    await project.pushConfig({
      'teams.allowClientTeamCreation': true,
    });

    // Both should be present
    let config = await project.getConfig();
    expect(config.users.allowClientUserDeletion).toBe(true); // from updateConfig
    expect(config.teams.allowClientTeamCreation).toBe(true); // from pushConfig

    // Push new config (replaces branch but not environment)
    await project.pushConfig({
      'auth.passkey.allowSignIn': true,
    });

    // updateConfig value should still be there
    config = await project.getConfig();
    expect(config.users.allowClientUserDeletion).toBe(true); // still from updateConfig
    expect(config.teams.allowClientTeamCreation).toBe(false); // back to default (old push gone)
    expect(config.auth.passkey.allowSignIn).toBe(true); // from new push
  });
});


describe("updatePushedConfig", () => {
  it("updatePushedConfig merges into pushed config", async ({ expect }) => {
    const { adminApp } = await createApp();
    const project = await adminApp.getProject();

    // Push initial config
    await project.pushConfig({
      'teams.allowClientTeamCreation': true,
    });

    // updatePushedConfig merges into the pushed config
    await project.updatePushedConfig({
      'teams.createPersonalTeamOnSignUp': true,
    });

    // Both values should be set
    const config = await project.getConfig();
    expect(config.teams.allowClientTeamCreation).toBe(true);
    expect(config.teams.createPersonalTeamOnSignUp).toBe(true);
  });

  it("pushConfig replaces updatePushedConfig changes", async ({ expect }) => {
    const { adminApp } = await createApp();
    const project = await adminApp.getProject();

    // Push initial config
    await project.pushConfig({
      'teams.allowClientTeamCreation': true,
    });

    // updatePushedConfig adds a value
    await project.updatePushedConfig({
      'teams.createPersonalTeamOnSignUp': true,
    });

    // Verify both values are present
    let config = await project.getConfig();
    expect(config.teams.allowClientTeamCreation).toBe(true);
    expect(config.teams.createPersonalTeamOnSignUp).toBe(true);

    // pushConfig replaces everything including updatePushedConfig changes
    await project.pushConfig({
      'auth.passkey.allowSignIn': true,
    });

    // Old values should be gone
    config = await project.getConfig();
    expect(config.teams.allowClientTeamCreation).toBe(false); // back to default
    expect(config.teams.createPersonalTeamOnSignUp).toBe(false); // back to default
    expect(config.auth.passkey.allowSignIn).toBe(true); // new push value
  });

  it("updateConfig takes precedence over updatePushedConfig", async ({ expect }) => {
    const { adminApp } = await createApp();
    const project = await adminApp.getProject();

    // updatePushedConfig sets a value at branch level
    await project.updatePushedConfig({
      'teams.allowClientTeamCreation': true,
    });

    // Verify value is applied
    let config = await project.getConfig();
    expect(config.teams.allowClientTeamCreation).toBe(true);

    // updateConfig overrides at environment level
    await project.updateConfig({
      'teams.allowClientTeamCreation': false,
    });

    // Environment-level takes precedence
    config = await project.getConfig();
    expect(config.teams.allowClientTeamCreation).toBe(false);
  });

  it("updatePushedConfig rejects environment-only fields", async ({ expect }) => {
    const { adminApp } = await createApp();
    const project = await adminApp.getProject();

    // updatePushedConfig uses branch level, so environment-only fields should be rejected
    await expect(project.updatePushedConfig({
      'auth.oauth.providers.google': {
        type: 'google',
        isShared: false,
        clientId: 'test-client-id',
        clientSecret: 'test-secret',
        allowSignIn: true,
        allowConnectedAccounts: true,
      },
    } as any)).rejects.toThrow(/auth\.oauth\.providers/);
  });
});
