const MCP_RPC_HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
};

const TOOL_ROUTE_HEADERS = {
  "Cache-Control": "private, no-store",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

const MCP_RPC_TIMEOUT_MS = 15_000;

type JsonRecord = Record<string, unknown>;

type McpTool = {
  name: string,
  inputSchema: JsonRecord | null,
};

class QueryArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueryArgumentError";
  }
}

class McpHttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "McpHttpError";
    this.status = status;
  }
}

class McpJsonRpcError extends Error {
  code: number;

  constructor(code: number, message: string) {
    super(message);
    this.name = "McpJsonRpcError";
    this.code = code;
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonFromMcpBody(body: string): unknown {
  const dataLine = body
    .split("\n")
    .find((line) => line.startsWith("data: "));

  return JSON.parse(dataLine == null ? body : dataLine.slice("data: ".length));
}

function getMcpPathname(pathname: string): string {
  if (pathname === "" || pathname === "/") {
    return "/mcp";
  }
  return pathname;
}

function normalizeMcpEndpointUrl(url: URL): URL {
  const normalized = new URL(url);
  normalized.pathname = getMcpPathname(normalized.pathname);
  normalized.search = "";
  normalized.hash = "";
  return normalized;
}

function getConfiguredMcpEndpointUrl(): URL | null {
  const configured =
    process.env.HEXCLAVE_MCP_BASE_URL ??
    process.env.STACK_MCP_BASE_URL;

  if (configured == null || configured.trim() === "") {
    return null;
  }

  return normalizeMcpEndpointUrl(new URL(configured));
}

function isLocalHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1" || hostname.endsWith(".localhost");
}

function getSiblingMcpUrl(req: Request): URL {
  const url = new URL(req.url);
  const sibling = new URL(url);

  if (sibling.hostname === "skill.hexclave.com") {
    sibling.hostname = "mcp.hexclave.com";
  } else if (isLocalHostname(sibling.hostname) && sibling.port.endsWith("45")) {
    sibling.port = `${sibling.port.slice(0, -2)}44`;
  } else {
    throw new QueryArgumentError("Unable to derive MCP endpoint URL for this skill host.");
  }

  sibling.pathname = "/mcp";
  sibling.search = "";
  sibling.hash = "";
  return sibling;
}

export function getMcpEndpointUrl(req: Request): URL {
  return getConfiguredMcpEndpointUrl() ?? getSiblingMcpUrl(req);
}

async function mcpJsonRpc(endpointUrl: URL, method: string, params?: unknown): Promise<unknown> {
  const body = params == null
    ? { jsonrpc: "2.0", id: 1, method }
    : { jsonrpc: "2.0", id: 1, method, params };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MCP_RPC_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(endpointUrl, {
      method: "POST",
      headers: MCP_RPC_HEADERS,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new McpHttpError(504, `MCP HTTP timeout after ${MCP_RPC_TIMEOUT_MS}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const text = await response.text();
  if (!response.ok) {
    throw new McpHttpError(response.status, `MCP HTTP error ${response.status}`);
  }

  const parsed = parseJsonFromMcpBody(text);
  if (isRecord(parsed) && isRecord(parsed.error)) {
    const code = typeof parsed.error.code === "number" ? parsed.error.code : -1;
    const message = typeof parsed.error.message === "string" ? parsed.error.message : JSON.stringify(parsed.error);
    throw new McpJsonRpcError(code, message);
  }

  return parsed;
}

function parseToolsListResponse(value: unknown): McpTool[] {
  if (!isRecord(value) || !isRecord(value.result) || !Array.isArray(value.result.tools)) {
    return [];
  }

  return value.result.tools.flatMap((tool) => {
    if (!isRecord(tool) || typeof tool.name !== "string") {
      return [];
    }

    return [{
      name: tool.name,
      inputSchema: isRecord(tool.inputSchema) ? tool.inputSchema : null,
    }];
  });
}

export async function listMcpTools(endpointUrl: URL): Promise<McpTool[]> {
  return parseToolsListResponse(await mcpJsonRpc(endpointUrl, "tools/list"));
}

function getPublicRouteNames(toolName: string): string[] {
  const routeNames = new Set<string>();
  routeNames.add(toolName);

  const hexclaveSuffix = "_hexclave";
  if (toolName.endsWith(hexclaveSuffix) && toolName.length > hexclaveSuffix.length) {
    routeNames.add(toolName.slice(0, -hexclaveSuffix.length));
  }

  return [...routeNames];
}

export function resolveMcpToolRoute(tools: McpTool[], routeName: string): McpTool | null {
  const exactTool = tools.find((tool) => tool.name === routeName);
  if (exactTool != null) {
    return exactTool;
  }

  let matchedTool: McpTool | null = null;
  for (const tool of tools) {
    if (!getPublicRouteNames(tool.name).includes(routeName)) {
      continue;
    }

    if (matchedTool != null) {
      throw new QueryArgumentError(`Route /${routeName} is ambiguous between MCP tools ${matchedTool.name} and ${tool.name}. Use the exact tool name instead.`);
    }

    matchedTool = tool;
  }

  return matchedTool;
}

export function getAvailableRouteNames(tools: McpTool[]): string[] {
  return [...new Set(tools.flatMap((tool) => getPublicRouteNames(tool.name)))].sort();
}

function getSchemaProperties(inputSchema: JsonRecord | null): Map<string, unknown> {
  if (inputSchema == null || !isRecord(inputSchema.properties)) {
    return new Map();
  }

  return new Map(Object.entries(inputSchema.properties));
}

function getSchemaType(schema: unknown): string | null {
  if (!isRecord(schema)) {
    return null;
  }

  if (typeof schema.type === "string") {
    return schema.type;
  }

  if (Array.isArray(schema.type)) {
    const stringType = schema.type.find((item) => typeof item === "string" && item !== "null");
    return typeof stringType === "string" ? stringType : null;
  }

  return null;
}

function parseJsonQueryValue(parameterName: string, value: string): unknown {
  try {
    return JSON.parse(value);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new QueryArgumentError(`Query parameter "${parameterName}" must be valid JSON.`);
    }
    throw error;
  }
}

function coerceQueryValue(parameterName: string, values: string[], schema: unknown): unknown {
  const schemaType = getSchemaType(schema);
  const value = values.length === 0 ? "" : values[values.length - 1];

  if (schemaType === "array") {
    if (values.length === 1 && value.trim().startsWith("[")) {
      return parseJsonQueryValue(parameterName, value);
    }
    return values;
  }

  if (schemaType === "object") {
    const parsed = parseJsonQueryValue(parameterName, value);
    if (!isRecord(parsed)) {
      throw new QueryArgumentError(`Query parameter "${parameterName}" must be a JSON object.`);
    }
    return parsed;
  }

  if (schemaType === "number" || schemaType === "integer") {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || (schemaType === "integer" && !Number.isInteger(parsed))) {
      throw new QueryArgumentError(`Query parameter "${parameterName}" must be a ${schemaType}.`);
    }
    return parsed;
  }

  if (schemaType === "boolean") {
    if (value === "true" || value === "1") {
      return true;
    }
    if (value === "false" || value === "0") {
      return false;
    }
    throw new QueryArgumentError(`Query parameter "${parameterName}" must be a boolean.`);
  }

  if (values.length > 1) {
    return values;
  }

  return value;
}

function getQueryParameterValues(searchParams: URLSearchParams): Map<string, string[]> {
  const values = new Map<string, string[]>();

  for (const [key, value] of searchParams.entries()) {
    const current = values.get(key);
    if (current == null) {
      values.set(key, [value]);
    } else {
      current.push(value);
    }
  }

  return values;
}

function applyQuestionAlias(values: Map<string, string[]>, properties: Map<string, unknown>): Map<string, string[]> {
  const copiedValues = new Map(values);

  if (
    properties.has("question") &&
    !properties.has("query") &&
    !copiedValues.has("question") &&
    copiedValues.has("query")
  ) {
    const queryValues = copiedValues.get("query");
    if (queryValues != null) {
      copiedValues.set("question", queryValues);
      copiedValues.delete("query");
    }
  }

  const questionValues = copiedValues.get("question");
  if (questionValues != null && properties.has("reason") && !copiedValues.has("reason")) {
    copiedValues.set("reason", ["skill-site MCP tool route"]);
  }

  // Public URL calls do not have an original agent prompt distinct from the
  // question, so use the question text for ask-style tools unless overridden.
  if (questionValues != null && properties.has("userPrompt") && !copiedValues.has("userPrompt")) {
    copiedValues.set("userPrompt", questionValues);
  }

  return copiedValues;
}

export function buildMcpToolArguments(tool: McpTool, searchParams: URLSearchParams): JsonRecord {
  const properties = getSchemaProperties(tool.inputSchema);
  const queryValues = applyQuestionAlias(getQueryParameterValues(searchParams), properties);
  const args: JsonRecord = Object.create(null);

  for (const [parameterName, values] of queryValues.entries()) {
    args[parameterName] = coerceQueryValue(parameterName, values, properties.get(parameterName));
  }

  return args;
}

function getToolResponseText(callResponse: unknown): { text: string, isError: boolean } {
  if (!isRecord(callResponse) || !isRecord(callResponse.result)) {
    return { text: JSON.stringify(callResponse, null, 2), isError: false };
  }

  const isError = callResponse.result.isError === true;
  if (!Array.isArray(callResponse.result.content)) {
    return { text: JSON.stringify(callResponse.result, null, 2), isError };
  }

  const text = callResponse.result.content.flatMap((contentItem) => {
    if (!isRecord(contentItem) || contentItem.type !== "text" || typeof contentItem.text !== "string") {
      return [];
    }

    return [contentItem.text];
  }).join("\n\n");

  return { text: text.length > 0 ? text : "(empty response)", isError };
}

export async function callMcpTool(endpointUrl: URL, tool: McpTool, searchParams: URLSearchParams): Promise<{ text: string, isError: boolean }> {
  const response = await mcpJsonRpc(endpointUrl, "tools/call", {
    name: tool.name,
    arguments: buildMcpToolArguments(tool, searchParams),
  });

  return getToolResponseText(response);
}

function getToolNameFromRequest(req: Request): string {
  const pathname = new URL(req.url).pathname;
  const routeName = pathname.split("/").filter((part) => part.length > 0).at(-1);
  if (routeName == null) {
    throw new QueryArgumentError("Missing MCP tool route name.");
  }
  try {
    return decodeURIComponent(routeName);
  } catch (error) {
    if (error instanceof URIError) {
      throw new QueryArgumentError("Malformed MCP tool route name encoding.");
    }
    throw error;
  }
}

function textResponse(text: string, status = 200): Response {
  return new Response(text, {
    status,
    headers: {
      ...TOOL_ROUTE_HEADERS,
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

function errorStatusForMcpError(error: McpJsonRpcError): number {
  if (error.code === -32601) {
    return 404;
  }

  if (error.code === -32602) {
    return 400;
  }

  return 502;
}

export async function handleMcpToolRoute(req: Request): Promise<Response> {
  try {
    const endpointUrl = getMcpEndpointUrl(req);
    const tools = await listMcpTools(endpointUrl);
    const routeName = getToolNameFromRequest(req);
    const tool = resolveMcpToolRoute(tools, routeName);

    if (tool == null) {
      return textResponse(`Unknown MCP tool route "/${routeName}". Available routes: ${getAvailableRouteNames(tools).join(", ")}`, 404);
    }

    if (req.method === "HEAD") {
      return textResponse("");
    }

    const response = await callMcpTool(endpointUrl, tool, new URL(req.url).searchParams);
    return textResponse(response.text, response.isError ? 502 : 200);
  } catch (error) {
    if (error instanceof QueryArgumentError) {
      return textResponse(error.message, 400);
    }

    if (error instanceof McpJsonRpcError) {
      return textResponse(`MCP JSON-RPC error ${error.code}`, errorStatusForMcpError(error));
    }

    if (error instanceof McpHttpError) {
      return textResponse(error.message, 502);
    }

    throw error;
  }
}

export function handleMcpToolOptions(): Response {
  return new Response(null, {
    status: 204,
    headers: TOOL_ROUTE_HEADERS,
  });
}


