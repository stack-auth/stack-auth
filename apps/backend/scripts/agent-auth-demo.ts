import * as jose from "jose";
import { HexclaveAdminApp, HexclaveServerApp } from "@hexclave/next";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { Client } from "pg";

const hexclavePortPrefix = getEnvVariable("NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX", "81");
const backendBaseUrl = getEnvVariable("NEXT_PUBLIC_HEXCLAVE_API_URL", `http://localhost:${hexclavePortPrefix}02`);
const projectId = getEnvVariable("HEXCLAVE_INTERNAL_PROJECT_ID", "internal");
const publishableClientKey = getEnvVariable("HEXCLAVE_INTERNAL_PROJECT_CLIENT_KEY", getEnvVariable("STACK_INTERNAL_PROJECT_CLIENT_KEY", ""));
const secretServerKey = getEnvVariable("HEXCLAVE_INTERNAL_PROJECT_SECRET_SERVER_KEY", getEnvVariable("STACK_INTERNAL_PROJECT_SERVER_KEY", ""));
const superSecretAdminKey = getEnvVariable("HEXCLAVE_SEED_INTERNAL_PROJECT_SUPER_SECRET_ADMIN_KEY");

const registerAudience = new URL("/api/latest/agent-auth/agents/register", backendBaseUrl).toString();
const executeAudience = new URL("/api/latest/agent-auth/capabilities/execute", backendBaseUrl).toString();

async function generateKeyPair() {
  const { publicKey, privateKey } = await jose.generateKeyPair("EdDSA", { crv: "Ed25519" });
  const jwk = await jose.exportJWK(publicKey);
  const thumbprint = await jose.calculateJwkThumbprint(jwk);
  return {
    privateKey,
    publicJwk: {
      ...jwk,
      alg: "EdDSA",
      crv: "Ed25519",
      kid: thumbprint,
      use: "sig",
    },
    thumbprint,
  };
}

async function signJwt(options: {
  privateKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"],
  thumbprint: string,
  typ: "host+jwt" | "agent+jwt",
  audience: string,
  expiresInSeconds: number,
}) {
  return await new jose.SignJWT({})
    .setProtectedHeader({ alg: "EdDSA", typ: options.typ, kid: options.thumbprint })
    .setIssuer(options.thumbprint)
    .setAudience(options.audience)
    .setIssuedAt()
    .setExpirationTime(`${options.expiresInSeconds}s`)
    .sign(options.privateKey);
}

async function main() {
  console.log("Agent Auth demo starting...");
  console.log(`Backend: ${backendBaseUrl}`);
  console.log(`Project: ${projectId}`);

  const adminApp = new HexclaveAdminApp({
    baseUrl: backendBaseUrl,
    projectId,
    publishableClientKey,
    secretServerKey,
    superSecretAdminKey,
    tokenStore: "memory",
    redirectMethod: "none",
  });
  const serverApp = new HexclaveServerApp({
    baseUrl: backendBaseUrl,
    projectId,
    publishableClientKey,
    secretServerKey,
    tokenStore: "memory",
    redirectMethod: "none",
  });
  const project = await adminApp.getProject();

  console.log("Enabling Agent Auth for the project...");
  await project.updateConfig({
    apps: {
      installed: {
        "agent-auth": {
          enabled: true,
        },
      },
    },
  });

  const users = await serverApp.listUsers({
    includeRestricted: true,
    orderBy: "signedUpAt",
    limit: 1,
  });
  const linkedUser = users.at(0);
  if (linkedUser == null) {
    throw new Error("No existing users found in the internal project");
  }
  console.log(`Linked real user: ${linkedUser.id} (${linkedUser.primaryEmail ?? "no primary email"})`);

  const hostKeys = await generateKeyPair();
  const agentKeys = await generateKeyPair();
  const hostJwt = await signJwt({
    privateKey: hostKeys.privateKey,
    thumbprint: hostKeys.thumbprint,
    typ: "host+jwt",
    audience: registerAudience,
    expiresInSeconds: 300,
  });

  console.log("Registering the host + agent...");
  const registerResponse = await fetch(registerAudience, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-stack-access-type": "server",
      "x-stack-project-id": projectId,
      "x-stack-publishable-client-key": publishableClientKey,
      "x-stack-secret-server-key": secretServerKey,
      authorization: `Bearer ${hostJwt}`,
    },
    body: JSON.stringify({
      host_public_jwk: hostKeys.publicJwk,
      agent_public_jwk: agentKeys.publicJwk,
      host_name: "demo-host",
      agent_name: "demo-agent",
      mode: "delegated",
      user_id: linkedUser.id,
      requested_capabilities: [
        {
          name: "list_users",
          constraints: {
            limit: {
              max: 3,
            },
          },
        },
        {
          name: "get_project_info",
        },
      ],
    }),
  });
  if (!registerResponse.ok) {
    throw new Error(`Register failed: ${registerResponse.status} ${await registerResponse.text()}`);
  }
  const registerBody = await registerResponse.json() as {
    agent_id: string,
    host_id: string,
    agent_thumbprint: string,
    host_thumbprint: string,
    granted_capabilities: Array<{ name: string, status: string }>,
  };
  console.log(`Registered agent ${registerBody.agent_id} under host ${registerBody.host_id}`);
  console.log(`Host thumbprint: ${registerBody.host_thumbprint}`);
  console.log(`Agent thumbprint: ${registerBody.agent_thumbprint}`);
  console.log(`Granted capabilities: ${registerBody.granted_capabilities.map((grant) => `${grant.name}:${grant.status}`).join(", ")}`);

  const agentJwt = await signJwt({
    privateKey: agentKeys.privateKey,
    thumbprint: agentKeys.thumbprint,
    typ: "agent+jwt",
    audience: executeAudience,
    expiresInSeconds: 60,
  });

  const execute = async (capability: string, input: Record<string, unknown>) => {
    const response = await fetch(executeAudience, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-stack-access-type": "server",
        "x-stack-project-id": projectId,
        "x-stack-publishable-client-key": publishableClientKey,
        "x-stack-secret-server-key": secretServerKey,
        authorization: `Bearer ${agentJwt}`,
      },
      body: JSON.stringify({ capability, input }),
    });
    if (!response.ok) {
      throw new Error(`Capability ${capability} failed: ${response.status} ${await response.text()}`);
    }
    return await response.json() as { result: unknown };
  };

  const listUsersResult = await execute("list_users", { limit: 2 });
  console.log("Capability list_users result:");
  console.log(JSON.stringify(listUsersResult.result, null, 2));

  const projectInfoResult = await execute("get_project_info", {});
  console.log("Capability get_project_info result:");
  console.log(JSON.stringify(projectInfoResult.result, null, 2));

  const agentsResponse = await fetch(new URL("/api/latest/agent-auth/agents", backendBaseUrl).toString(), {
    headers: {
      "x-stack-access-type": "admin",
      "x-stack-project-id": projectId,
      "x-stack-publishable-client-key": publishableClientKey,
      "x-stack-secret-server-key": secretServerKey,
      "x-stack-super-secret-admin-key": superSecretAdminKey,
    },
  });
  if (!agentsResponse.ok) {
    throw new Error(`GET agents failed: ${agentsResponse.status} ${await agentsResponse.text()}`);
  }
  const agentsBody = await agentsResponse.json() as { agents: Array<{ id: string, name: string, status: string, host: { name: string } }> };
  console.log("Registered agents:");
  console.log(JSON.stringify(agentsBody.agents.filter((agent) => agent.id === registerBody.agent_id), null, 2));

  const auditConnectionString = getEnvVariable(
    "HEXCLAVE_DATABASE_CONNECTION_STRING",
    getEnvVariable("STACK_DATABASE_CONNECTION_STRING", ""),
  );
  if (auditConnectionString === "") {
    throw new Error("A local database connection string is required for audit lookup");
  }
  const auditClient = new Client({ connectionString: auditConnectionString });
  await auditClient.connect();
  const audit = await auditClient.query<{
    systemEventTypeIds: string[],
    data: { actor?: { type?: string, agentId?: string, hostId?: string, userId?: string } } | null,
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
  await auditClient.end();
  console.log("Audit events showing the agent actor envelope:");
  console.log(JSON.stringify(audit.rows, null, 2));

  console.log("Agent Auth demo complete.");
}

// eslint-disable-next-line no-restricted-syntax -- standalone script handles its own fatal error path
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
