import { STACK_BACKEND_BASE_URL, STACK_MCP_BASE_URL, it, niceFetch, updateCookiesFromResponse } from "../../../../../helpers";
import { Auth, Team, backendContext, niceBackendFetch, withInternalProject } from "../../../../backend-helpers";
import { createHash, randomBytes } from "node:crypto";
import { throwErr } from "@hexclave/shared/dist/utils/errors";

async function mcpRequest(body: unknown, path = "/api/internal/mcp", accessToken?: string) {
  return await niceFetch(new URL(path, STACK_MCP_BASE_URL), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(accessToken === undefined ? {} : { authorization: `Bearer ${accessToken}` }),
    },
    body: JSON.stringify(body),
  });
}

async function obtainInternalMcpToken(resourceUri: string, scope: string, userAccessToken: string): Promise<string> {
  const issuer = new URL("/api/v1/projects/internal/oidc", STACK_BACKEND_BASE_URL).toString();
  const redirectUri = "http://127.0.0.1:8765/mcp-callback";
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  const authorizationResponse = await niceBackendFetch(`${issuer}/authorize`, {
    method: "GET",
    accessType: null,
    redirect: "manual",
    query: {
      client_id: "mcp-e2e",
      redirect_uri: redirectUri,
      response_type: "code",
      scope: `openid profile ${scope}`,
      resource: resourceUri,
      state: "mcp-e2e-state",
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    },
  });
  const interactionCookies = updateCookiesFromResponse("", authorizationResponse);
  const hostedUrl = new URL(authorizationResponse.headers.get("location") ?? throwErr("Missing hosted interaction redirect"));
  const interactionUid = hostedUrl.searchParams.get("interaction_uid") ?? throwErr("Missing interaction UID");
  const approvalResponse = await niceBackendFetch("/api/v1/projects/internal/oauth-approval", {
    method: "POST",
    accessType: "client",
    userAuth: { accessToken: userAccessToken },
    body: { interaction_uid: interactionUid },
  });
  const oneTimeCode = typeof approvalResponse.body.code === "string"
    ? approvalResponse.body.code
    : throwErr("Missing interaction approval code");
  const completionResponse = await niceBackendFetch(`${issuer}/interaction/${encodeURIComponent(interactionUid)}/done`, {
    accessType: null,
    redirect: "manual",
    headers: { cookie: interactionCookies },
    query: { code: oneTimeCode },
  });
  const completionCookies = updateCookiesFromResponse(interactionCookies, completionResponse);
  let callbackUrl = new URL(`${issuer}/authorize/${interactionUid}`);
  if (callbackUrl.origin === new URL(STACK_BACKEND_BASE_URL).origin) {
    const resumeResponse = await niceBackendFetch(callbackUrl.toString(), {
      accessType: null,
      redirect: "manual",
      headers: { cookie: completionCookies },
    });
    callbackUrl = new URL(resumeResponse.headers.get("location") ?? throwErr("Missing MCP callback redirect"));
  }
  const authorizationCode = callbackUrl.searchParams.get("code") ?? throwErr("Missing authorization code");
  const tokenResponse = await niceBackendFetch(`${issuer}/token`, {
    method: "POST",
    accessType: null,
    rawContentType: "application/x-www-form-urlencoded",
    rawBody: new TextEncoder().encode(new URLSearchParams({
      grant_type: "authorization_code",
      code: authorizationCode,
      client_id: "mcp-e2e",
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
      resource: resourceUri,
    }).toString()),
  });
  if (tokenResponse.status !== 200) {
    throw new Error(`MCP token exchange failed with status ${tokenResponse.status}`);
  }
  return tokenResponse.body.access_token;
}

it("authenticates the MCP handler with an OAuth resource token and preserves scope/resource boundaries", async ({ expect }) => {
  await withInternalProject(async () => {
    const resourceUri = new URL("/mcp", STACK_MCP_BASE_URL).toString();
    const otherResourceUri = new URL("/other-mcp", STACK_MCP_BASE_URL).toString();
    const oauthConfigResponse = await niceBackendFetch("/api/latest/internal/config/override/branch", {
      method: "PATCH",
      accessType: "admin",
      body: {
        config_override_string: JSON.stringify({
          oauthProvider: {
            resources: {
              mcp: {
                displayName: "Hexclave MCP",
                uri: resourceUri,
                scopes: {
                  listProjects: { scope: "mcp:list-projects" },
                  sqlQuery: { scope: "mcp:sql-query" },
                  readConfig: { scope: "mcp:read-config" },
                },
              },
              other: {
                displayName: "Other resource",
                uri: otherResourceUri,
                scopes: {
                  listProjects: { scope: "mcp:list-projects" },
                },
              },
            },
            clients: {
              "mcp-e2e": {
                displayName: "MCP E2E client",
                redirectUris: {
                  callback: { url: "http://127.0.0.1:8765/mcp-callback" },
                },
              },
            },
          },
        }),
      },
    });
    expect(oauthConfigResponse.status).toBe(200);

    const signup = await Auth.Password.signUpWithEmail({ noWaitForEmail: true });
    backendContext.set({ userAuth: { accessToken: signup.signUpResponse.body.access_token } });
    const ownedTeam = await Team.create({ accessType: "server", creatorUserId: signup.signUpResponse.body.user_id }, { display_name: "MCP Golden Path Team" });
    const ownedProjectResponse = await niceBackendFetch("/api/v1/internal/projects", {
      method: "POST",
      accessType: "client",
      userAuth: { accessToken: signup.signUpResponse.body.access_token },
      body: {
        display_name: "MCP Golden Path Project",
        owner_team_id: ownedTeam.teamId,
        config: {
          allow_localhost: true,
        },
      },
    });
    expect(ownedProjectResponse.status).toBe(201);
    const ownedProjectId = ownedProjectResponse.body.id;
    const fullScope = "mcp:list-projects mcp:sql-query mcp:read-config";
    const fullScopeToken = await obtainInternalMcpToken(resourceUri, fullScope, signup.signUpResponse.body.access_token);
    const listProjectsToken = await obtainInternalMcpToken(resourceUri, "mcp:list-projects", signup.signUpResponse.body.access_token);
    const listResponse = await mcpRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "list_projects", arguments: {} },
    }, "/api/internal/mcp", listProjectsToken);
    expect(listResponse.status).toBe(200);
    const listResult = parseMcpBody(listResponse.body);
    expect(listResult).toMatchObject({ result: { content: [{ type: "text" }] } });
    const listText = getMcpTextResult(listResult);
    expect(JSON.parse(listText)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: ownedProjectId }),
    ]));

    const configResponse = await mcpRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "read_config",
        arguments: { project_id: ownedProjectId },
      },
    }, "/api/internal/mcp", fullScopeToken);
    expect(configResponse.status).toBe(200);
    const configResult = parseMcpBody(configResponse.body);
    expect(configResult).toMatchObject({ result: { content: [{ type: "text" }] } });
    const configText = getMcpTextResult(configResult);
    expect(JSON.parse(configText)).toMatchObject({
      success: true,
      config: expect.anything(),
    });

    const queryResponse = await mcpRequest({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "sql_query",
        arguments: { project_id: ownedProjectId, query: "SELECT 1 AS value LIMIT 1" },
      },
    }, "/api/internal/mcp", fullScopeToken);
    expect(queryResponse.status).toBe(200);
    const queryResult = parseMcpBody(queryResponse.body);
    expect(queryResult).toMatchObject({ result: { content: [{ type: "text" }] } });
    expect(JSON.parse(getMcpTextResult(queryResult))).toMatchObject({
      success: true,
      result: [{ value: 1 }],
    });

    const deniedResponse = await mcpRequest({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "sql_query",
        arguments: { project_id: "not-managed", query: "SELECT 1" },
      },
    }, "/api/internal/mcp", fullScopeToken);
    expect(parseMcpBody(deniedResponse.body)).toMatchObject({
      result: { isError: true },
    });

    const scopeDeniedResponse = await mcpRequest({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "sql_query",
        arguments: { project_id: ownedProjectId, query: "SELECT 1" },
      },
    }, "/api/internal/mcp", listProjectsToken);
    expect(parseMcpBody(scopeDeniedResponse.body)).toMatchObject({
      result: { isError: true },
    });

    const wrongResourceToken = await obtainInternalMcpToken(otherResourceUri, "mcp:list-projects", signup.signUpResponse.body.access_token);
    const wrongResourceResponse = await mcpRequest({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: { name: "list_projects", arguments: {} },
    }, "/api/internal/mcp", wrongResourceToken);
    expect(wrongResourceResponse.status).toBe(401);
  });
});

function parseMcpBody(body: unknown): unknown {
  if (typeof body !== "string") {
    return body;
  }

  const dataLine = body
    .split("\n")
    .find((line) => line.startsWith("data: "));
  if (dataLine == null) {
    return JSON.parse(body);
  }

  return JSON.parse(dataLine.slice("data: ".length));
}

function getMcpTextResult(body: unknown): string {
  if (typeof body !== "object" || body === null || !("result" in body) || typeof body.result !== "object" || body.result === null || !("content" in body.result) || !Array.isArray(body.result.content)) {
    throwErr("MCP response did not contain a tool result");
  }
  const text = body.result.content.find(content => typeof content === "object" && content !== null && "type" in content && content.type === "text" && "text" in content && typeof content.text === "string");
  if (text == null || typeof text !== "object" || !("text" in text) || typeof text.text !== "string") {
    throwErr("MCP response did not contain a text tool result");
  }
  return text.text;
}

function getMcpToolNames(body: unknown): string[] {
  if (typeof body !== "object" || body === null || !("result" in body) || typeof body.result !== "object" || body.result === null || !("tools" in body.result) || !Array.isArray(body.result.tools)) {
    throwErr("MCP response did not contain a tools list");
  }
  return body.result.tools.flatMap(tool => typeof tool === "object" && tool !== null && "name" in tool && typeof tool.name === "string" ? [tool.name] : []);
}

it("internal MCP endpoint should expose the Hexclave docs assistant tool", async ({ expect }) => {
  const response = await mcpRequest({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
  });

  expect(response.status).toBe(200);
  expect(getMcpToolNames(parseMcpBody(response.body))).toEqual(expect.arrayContaining(["ask_hexclave", "list_projects", "sql_query", "read_config"]));
});

it("public MCP endpoint should expose the Hexclave docs assistant tool", async ({ expect }) => {
  const response = await mcpRequest({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
  }, "/mcp");

  expect(response.status).toBe(200);
  expect(getMcpToolNames(parseMcpBody(response.body))).toEqual(expect.arrayContaining(["ask_hexclave", "list_projects", "sql_query", "read_config"]));
});

it("public MCP account tools return an authentication-required result without a token", async ({ expect }) => {
  const response = await mcpRequest({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "list_projects", arguments: {} },
  }, "/mcp");

  expect(response.status).toBe(200);
  expect(parseMcpBody(response.body)).toMatchObject({
    result: {
      isError: true,
      content: [{ type: "text", text: expect.stringContaining("Authentication is required") }],
    },
  });
});

it("public MCP endpoint should expose prompts and resources without method-not-found errors", async ({ expect }) => {
  const promptsResponse = await mcpRequest({
    jsonrpc: "2.0",
    id: 1,
    method: "prompts/list",
  }, "/mcp");

  expect(promptsResponse.status).toBe(200);
  expect(parseMcpBody(promptsResponse.body)).toMatchObject({
    result: {
      prompts: [
        {
          name: "skill",
        },
      ],
    },
  });

  const resourcesResponse = await mcpRequest({
    jsonrpc: "2.0",
    id: 1,
    method: "resources/list",
  }, "/mcp");

  expect(resourcesResponse.status).toBe(200);
  expect(parseMcpBody(resourcesResponse.body)).toMatchObject({
    result: {
      resources: [
        {
          uri: "https://skill.hexclave.com/full",
          name: "skill",
        },
      ],
    },
  });
});

it("MCP service root should redirect GET and POST to /mcp", async ({ expect }) => {
  const response = await niceFetch(new URL("/", STACK_MCP_BASE_URL), {
    method: "GET",
    redirect: "manual",
  });

  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toBe("/mcp");

  const postResponse = await niceFetch(new URL("/", STACK_MCP_BASE_URL), {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    }),
  });

  expect(postResponse.status).toBe(307);
  expect(postResponse.headers.get("location")).toBe("/mcp");
});

it("MCP setup page should show client installation instructions", async ({ expect }) => {
  const mcpUrl = new URL("/mcp", STACK_MCP_BASE_URL).toString();
  const response = await niceFetch(new URL("/mcp", STACK_MCP_BASE_URL), {
    method: "GET",
    headers: {
      accept: "text/html",
    },
  });

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/html");
  expect(response.body).toContain("Hexclave MCP Setup");
  expect(response.body).toContain("Cursor");
  expect(response.body).toContain("Codex");
  expect(response.body).toContain("Claude Code");
  expect(response.body).toContain("VS Code");
  expect(response.body).toContain(`codex mcp add hexclave --url ${mcpUrl}`);
  expect(response.body).toContain(mcpUrl);
  expect(response.body).not.toContain("stack-auth");
  expect(response.body).not.toContain("https://mcp.stack-auth.com/mcp");
  expect(response.body).not.toContain("Set up Stack Auth's Model Context Protocol (MCP) server to get intelligent code assistance in your development environment.");
  expect(response.body).toContain("<details class=\"markdown-section\">");
  expect(response.body).not.toContain("<details class=\"markdown-section\" open>");
});

it("internal MCP endpoint should reject missing required docs assistant fields before invoking AI", async ({ expect }) => {
  const response = await mcpRequest({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "ask_hexclave",
      arguments: {
        question: "How do I set up OAuth?",
        userPrompt: "How do I set up OAuth?",
      },
    },
  });

  expect(response.status).toBe(200);
  expect(parseMcpBody(response.body)).toMatchInlineSnapshot(`
    {
      "error": {
        "code": -32602,
        "message": deindent\`
          MCP error -32602: Invalid arguments for tool ask_hexclave: [
            {
              "code": "invalid_type",
              "expected": "string",
              "received": "undefined",
              "path": [
                "reason"
              ],
              "message": "Required"
            }
          ]
        \`,
      },
      "id": 1,
      "jsonrpc": "2.0",
    }
  `);
});
