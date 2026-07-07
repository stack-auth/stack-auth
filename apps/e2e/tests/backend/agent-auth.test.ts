import * as jose from "jose";
import { Client } from "pg";
import { describe } from "vitest";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { wait } from "@hexclave/shared/dist/utils/promises";
import { STACK_BACKEND_BASE_URL, it } from "../helpers";
import { Auth, Project, niceBackendFetch, withInternalProject } from "./backend-helpers";

const AGENT_AUTH_REGISTER_AUDIENCE = new URL("/api/latest/agent-auth/agents/register", STACK_BACKEND_BASE_URL).toString();
const AGENT_AUTH_EXECUTE_AUDIENCE = new URL("/api/latest/agent-auth/capabilities/execute", STACK_BACKEND_BASE_URL).toString();

async function generateEd25519KeyPair() {
  const { publicKey, privateKey } = await jose.generateKeyPair("EdDSA", { crv: "Ed25519" });
  const publicJwk = await jose.exportJWK(publicKey);
  const thumbprint = await jose.calculateJwkThumbprint(publicJwk);
  return {
    publicKey,
    privateKey,
    thumbprint,
    publicJwk: {
      ...publicJwk,
      alg: "EdDSA",
      crv: "Ed25519",
      kid: thumbprint,
      use: "sig",
    },
  };
}

async function signJwt(options: {
  privateKey: jose.KeyLike,
  thumbprint: string,
  typ: "host+jwt" | "agent+jwt",
  audience: string,
  expiresInSeconds: number,
  claims?: Record<string, unknown>,
}) {
  return await new jose.SignJWT(options.claims ?? {})
    .setProtectedHeader({ alg: "EdDSA", typ: options.typ, kid: options.thumbprint })
    .setIssuer(options.thumbprint)
    .setAudience(options.audience)
    .setIssuedAt()
    .setExpirationTime(`${options.expiresInSeconds}s`)
    .sign(options.privateKey);
}

describe("agent auth", () => {
  it("registers, executes, and audits a real agent", async ({ expect }) => {
    await withInternalProject(async () => {
      await Project.updateConfig({
        apps: {
          installed: {
            "agent-auth": {
              enabled: true,
            },
          },
        },
      });

      const { userId } = await Auth.fastSignUp();
      const hostKeys = await generateEd25519KeyPair();
      const agentKeys = await generateEd25519KeyPair();

      const hostJwt = await signJwt({
        privateKey: hostKeys.privateKey,
        thumbprint: hostKeys.thumbprint,
        typ: "host+jwt",
        audience: AGENT_AUTH_REGISTER_AUDIENCE,
        expiresInSeconds: 300,
      });

      const registerResponse = await niceBackendFetch("/api/latest/agent-auth/agents/register", {
        accessType: "server",
        method: "POST",
        headers: {
          authorization: `Bearer ${hostJwt}`,
        },
        body: {
          host_public_jwk: hostKeys.publicJwk,
          agent_public_jwk: agentKeys.publicJwk,
          host_name: "e2e-host",
          agent_name: "e2e-agent",
          mode: "delegated",
          user_id: userId,
          requested_capabilities: [
            {
              name: "list_users",
              constraints: {
                limit: {
                  max: 2,
                },
              },
            },
            {
              name: "get_project_info",
              constraints: {},
            },
          ],
        },
      });
      expect(registerResponse.status).toBe(201);

      const agentJwt = await signJwt({
        privateKey: agentKeys.privateKey,
        thumbprint: agentKeys.thumbprint,
        typ: "agent+jwt",
        audience: AGENT_AUTH_EXECUTE_AUDIENCE,
        expiresInSeconds: 60,
      });

      const listUsersResponse = await niceBackendFetch("/api/latest/agent-auth/capabilities/execute", {
        accessType: "server",
        method: "POST",
        headers: {
          authorization: `Bearer ${agentJwt}`,
        },
        body: {
          capability: "list_users",
          input: {
            limit: 1,
          },
        },
      });
      expect(listUsersResponse.status).toBe(200);
      expect(listUsersResponse.body.result.users).toHaveLength(1);

      const projectInfoResponse = await niceBackendFetch("/api/latest/agent-auth/capabilities/execute", {
        accessType: "server",
        method: "POST",
        headers: {
          authorization: `Bearer ${agentJwt}`,
        },
        body: {
          capability: "get_project_info",
          input: {},
        },
      });
      expect(projectInfoResponse.status).toBe(200);
      expect(projectInfoResponse.body.result.project_id).toBe("internal");

      const agentsResponse = await niceBackendFetch("/api/latest/agent-auth/agents", {
        accessType: "admin",
        method: "GET",
      });
      expect(agentsResponse.status).toBe(200);
      expect(agentsResponse.body.agents.some((agent: { name: string }) => agent.name === "e2e-agent")).toBe(true);

      const connectionString = getEnvVariable(
        "HEXCLAVE_DATABASE_CONNECTION_STRING",
        getEnvVariable("STACK_DATABASE_CONNECTION_STRING", ""),
      );
      if (connectionString === "") {
        throw new Error("A local database connection string is required for audit verification");
      }
      const auditDb = new Client({ connectionString });
      await auditDb.connect();
      let auditEvents: Array<{
        systemEventTypeIds: string[],
        data: { actor?: { type?: string } } | null,
      }> = [];
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const auditEventsResult = await auditDb.query<{
          systemEventTypeIds: string[],
          data: { actor?: { type?: string } } | null,
        }>(
          `
            SELECT "systemEventTypeIds", data
            FROM "Event"
            WHERE "systemEventTypeIds" && ARRAY[$1, $2]
            ORDER BY "createdAt" DESC
            LIMIT 10
          `,
          ["$agent-registered", "$agent-capability-executed"],
        );
        auditEvents = auditEventsResult.rows;
        if (auditEvents.some((row) => {
          const data = row.data ?? {};
          return row.systemEventTypeIds.includes("$agent-capability-executed") && data.actor?.type === "agent";
        })) {
          break;
        }
        await wait(250);
      }
      await auditDb.end();
      expect(auditEvents.some((row) => {
        const data = row.data ?? {};
        return row.systemEventTypeIds.includes("$agent-capability-executed") && data.actor?.type === "agent";
      })).toBe(true);
    });
  });
});
