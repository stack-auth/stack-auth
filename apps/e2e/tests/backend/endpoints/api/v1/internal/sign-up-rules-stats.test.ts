import { wait } from "@stackframe/stack-shared/dist/utils/promises";
import { describe } from "vitest";
import { it } from "../../../../../helpers";
import { Auth, Project, backendContext, niceBackendFetch } from "../../../../backend-helpers";


describe("without project access", () => {
  backendContext.set({
    projectKeys: 'no-project'
  });

  it("should not have access to sign-up rules stats", async ({ expect }) => {
    const response = await niceBackendFetch("/api/v1/internal/sign-up-rules-stats", { accessType: "client" });
    expect(response).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 400,
        "body": {
          "code": "ACCESS_TYPE_WITHOUT_PROJECT_ID",
          "details": { "request_type": "client" },
          "error": deindent\`
            The x-stack-access-type header was 'client', but the x-stack-project-id header was not provided.
            
            For more information, see the docs on REST API authentication: https://docs.stack-auth.com/rest-api/overview#authentication
          \`,
        },
        "headers": Headers {
          "x-stack-known-error": "ACCESS_TYPE_WITHOUT_PROJECT_ID",
          <some fields may have been hidden>,
        },
      }
    `);
  });
});

describe("with client access", () => {
  it("should not have access to sign-up rules stats", async ({ expect }) => {
    const response = await niceBackendFetch("/api/v1/internal/sign-up-rules-stats", { accessType: "client" });
    expect(response).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 401,
        "body": {
          "code": "INSUFFICIENT_ACCESS_TYPE",
          "details": {
            "actual_access_type": "client",
            "allowed_access_types": ["admin"],
          },
          "error": "The x-stack-access-type header must be 'admin', but was 'client'.",
        },
        "headers": Headers {
          "x-stack-known-error": "INSUFFICIENT_ACCESS_TYPE",
          <some fields may have been hidden>,
        },
      }
    `);
  });
});

describe("with server access", () => {
  it("should not have access to sign-up rules stats", async ({ expect }) => {
    const response = await niceBackendFetch("/api/v1/internal/sign-up-rules-stats", { accessType: "server" });
    expect(response).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 401,
        "body": {
          "code": "INSUFFICIENT_ACCESS_TYPE",
          "details": {
            "actual_access_type": "server",
            "allowed_access_types": ["admin"],
          },
          "error": "The x-stack-access-type header must be 'admin', but was 'server'.",
        },
        "headers": Headers {
          "x-stack-known-error": "INSUFFICIENT_ACCESS_TYPE",
          <some fields may have been hidden>,
        },
      }
    `);
  });
});

describe("with admin access", () => {
  it("should return empty stats when no rules have been triggered", async ({ expect }) => {
    await Project.createAndSwitch({ config: {} });
    const response = await niceBackendFetch("/api/v1/internal/sign-up-rules-stats", { accessType: "admin" });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      rule_triggers: [],
      total_triggers: 0,
      triggers_by_action: {
        allow: 0,
        reject: 0,
        restrict: 0,
        log: 0,
      },
    });
  });

  it("should return stats structure with proper fields", async ({ expect }) => {
    await Project.createAndSwitch({ config: {} });
    const response = await niceBackendFetch("/api/v1/internal/sign-up-rules-stats", { accessType: "admin" });
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('rule_triggers');
    expect(response.body).toHaveProperty('total_triggers');
    expect(response.body).toHaveProperty('triggers_by_action');
    expect(response.body.triggers_by_action).toHaveProperty('allow');
    expect(response.body.triggers_by_action).toHaveProperty('reject');
    expect(response.body.triggers_by_action).toHaveProperty('restrict');
    expect(response.body.triggers_by_action).toHaveProperty('log');
  });

  it("should track rule triggers after a rule matches", async ({ expect }) => {
    // Create a project with a sign-up rule that will match
    await Project.createAndSwitch();
    await Project.updateConfig({
      'auth.signUpRules.test-rule': {
        enabled: true,
        displayName: 'Test Rule',
        priority: 1,
        condition: 'true', // Always matches
        action: {
          type: 'log',
        },
      },
    });

    // If we're in the last 10 seconds of the hour, wait until the next hour so our tests aren't flakey
    const now = new Date();
    const lastSecondOfHour = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), 59, 50);
    if (now.getTime() > lastSecondOfHour.getTime()) {
      await wait(1_000 + 10_000 - (now.getTime() - lastSecondOfHour.getTime()));
    }

    // Sign up a user to trigger the rule
    const { userId } = await Auth.Password.signUpWithEmail();

    const response = await niceBackendFetch("/api/v1/internal/sign-up-rules-stats", { accessType: "admin" });
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.rule_triggers)).toBe(true);
    expect(typeof response.body.total_triggers).toBe('number');
    expect(response).toMatchInlineSnapshot(`
      NiceResponse {
        "status": 200,
        "body": {
          "rule_triggers": [
            {
              "hourly_counts": <stripped field 'hourly_counts'>,
              "rule_id": "test-rule",
              "total_count": 1,
            },
          ],
          "total_triggers": 1,
          "triggers_by_action": {
            "allow": 0,
            "log": 1,
            "reject": 0,
            "restrict": 0,
          },
        },
        "headers": Headers { <some fields may have been hidden> },
      }
    `);
    const hourlyCounts = response.body.rule_triggers[0].hourly_counts;
    expect(hourlyCounts.length).toBe(48);
    for (let i = 0; i < hourlyCounts.length - 1; i++) {
      expect(hourlyCounts[i].hour).toEqual(new Date(new Date().getTime() - (hourlyCounts.length - 1 - i) * 60 * 60 * 1000).toISOString().slice(0, 13) + ':00:00.000Z');
      expect(hourlyCounts[i].count).toBe(0);
    }
    const lastHourlyCount = hourlyCounts[hourlyCounts.length - 1];
    expect(lastHourlyCount.hour).toEqual(new Date().toISOString().slice(0, 13) + ':00:00.000Z');
    expect(lastHourlyCount.count).toBe(1);
  });
});
