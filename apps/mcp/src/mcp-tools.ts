import { z } from "zod";

import {
  getMcpAuthenticationHeaders,
  getMcpRequestContext,
} from "@/mcp-auth";
import { getMcpConfig } from "@/mcp-config";
import { assertManagedProject, type McpProjectSummary } from "@/mcp-projects";

const SESSION_TTL_MILLIS = 10_000;
const LIST_PROJECTS_SCOPE = "mcp:list-projects";
const SQL_QUERY_SCOPE = "mcp:sql-query";
const READ_CONFIG_SCOPE = "mcp:read-config";

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function requireMcpUser(scope: string): NonNullable<ReturnType<typeof getMcpRequestContext>> {
  const context = getMcpRequestContext();
  if (context === null) {
    throw new Error(`Authentication is required for this tool. Link your account using OAuth for ${getMcpConfig().resourceUri}.`);
  }
  if (!context.authInfo.scopes.includes(scope)) {
    throw new Error(`The authenticated token does not grant the required scope: ${scope}.`);
  }
  return context;
}

async function withShortLivedUserSession<T>(
  user: NonNullable<ReturnType<typeof getMcpRequestContext>>["user"],
  callback: (accessToken: string) => Promise<T>,
): Promise<T> {
  // The MCP JWT is resource-bound and the main API intentionally does not accept it as an ordinary user access token.
  // Mint this shortest-useful session only as a bridge to the internal tool endpoint, and never cache or expose it.
  const session = await user.createSession({ expiresInMillis: SESSION_TTL_MILLIS });
  const { accessToken } = await session.getTokens();
  if (accessToken === null) {
    throw new Error("Could not create a short-lived backend session.");
  }
  return await callback(accessToken);
}

async function fetchInternalApi(path: string, accessToken: string): Promise<Response> {
  return await fetch(`${getMcpConfig().apiUrl}/api/latest${path}`, {
    headers: getMcpAuthenticationHeaders(accessToken),
  });
}

async function fetchJson<T>(path: string, accessToken: string): Promise<T> {
  const response = await fetchInternalApi(path, accessToken);
  if (!response.ok) {
    throw new Error("The Hexclave API rejected the MCP request.");
  }
  return await response.json();
}

async function callInternalTool(options: {
  accessToken: string,
  projectId: string,
  toolName: "sql-query" | "read-config",
  query?: string,
}): Promise<unknown> {
  const response = await fetch(`${getMcpConfig().apiUrl}/api/latest/internal/mcp/tools/${options.toolName}`, {
    method: "POST",
    headers: {
      ...Object.fromEntries(getMcpAuthenticationHeaders(options.accessToken)),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      project_id: options.projectId,
      ...(options.query === undefined ? {} : { query: options.query }),
    }),
  });
  if (!response.ok) {
    throw new Error("The Hexclave internal MCP tool endpoint rejected the request.");
  }
  return await response.json();
}

export async function listProjectsTool() {
  const context = requireMcpUser(LIST_PROJECTS_SCOPE);
  return await withShortLivedUserSession(context.user, async (accessToken) => {
    const result = await fetchJson<{ items: McpProjectSummary[] }>("/internal/projects", accessToken);
    return textResult(JSON.stringify(result.items.map(({ id, display_name, description }) => ({
      id,
      display_name,
      description,
    }))));
  });
}

export async function sqlQueryTool(args: { project_id: string, query: string }) {
  const context = requireMcpUser(SQL_QUERY_SCOPE);
  const projectId = z.string().min(1).parse(args.project_id);
  const query = z.string().min(1).parse(args.query);
  return await withShortLivedUserSession(context.user, async (accessToken) => {
    const projects = await fetchJson<{ items: McpProjectSummary[] }>("/internal/projects", accessToken);
    assertManagedProject(projects.items, projectId);
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify(await callInternalTool({
          accessToken,
          projectId,
          toolName: "sql-query",
          query,
        })),
      }],
    };
  });
}

export async function readConfigTool(args: { project_id: string }) {
  const context = requireMcpUser(READ_CONFIG_SCOPE);
  const projectId = z.string().min(1).parse(args.project_id);
  return await withShortLivedUserSession(context.user, async (accessToken) => {
    const projects = await fetchJson<{ items: McpProjectSummary[] }>("/internal/projects", accessToken);
    assertManagedProject(projects.items, projectId);
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify(await callInternalTool({
          accessToken,
          projectId,
          toolName: "read-config",
        })),
      }],
    };
  });
}
