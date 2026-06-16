import { envOrDevDefault } from "./env";

function publicEnv(hexclaveName: string, legacyStackName: string): string | undefined {
  return process.env[hexclaveName] ?? process.env[legacyStackName];
}

const PORT_PREFIX = process.env.NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX ?? "81";
const API_URL = envOrDevDefault(
  publicEnv("NEXT_PUBLIC_HEXCLAVE_API_URL", "NEXT_PUBLIC_STACK_API_URL"),
  `http://localhost:${PORT_PREFIX}02`,
  "NEXT_PUBLIC_HEXCLAVE_API_URL",
);
const PROJECT_ID = envOrDevDefault(
  publicEnv("NEXT_PUBLIC_HEXCLAVE_PROJECT_ID", "NEXT_PUBLIC_STACK_PROJECT_ID"),
  "internal",
  "NEXT_PUBLIC_HEXCLAVE_PROJECT_ID",
);
const PUBLISHABLE_CLIENT_KEY = envOrDevDefault(
  publicEnv("NEXT_PUBLIC_HEXCLAVE_PUBLISHABLE_CLIENT_KEY", "NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY"),
  "this-publishable-client-key-is-for-local-development-only",
  "NEXT_PUBLIC_HEXCLAVE_PUBLISHABLE_CLIENT_KEY",
);

export type SpacetimeBrowserSessionResponse = {
  host: string,
  dbName: string,
  identity: string,
  token?: string,
  scopeKey: string,
};

function readStringProperty(value: unknown, property: string): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const propertyValue = Reflect.get(value, property);
  return typeof propertyValue === "string" ? propertyValue : undefined;
}

function parseSpacetimeBrowserSessionResponse(value: unknown): SpacetimeBrowserSessionResponse {
  const host = readStringProperty(value, "host");
  const dbName = readStringProperty(value, "dbName");
  const identity = readStringProperty(value, "identity");
  const token = readStringProperty(value, "token");
  const scopeKey = readStringProperty(value, "scopeKey");
  if (host == null || dbName == null || identity == null || scopeKey == null) {
    throw new Error("SpacetimeDB browser session API returned an invalid response");
  }
  return { host, dbName, identity, token, scopeKey };
}

async function post(path: string, body: unknown, authHeaders: Record<string, string>): Promise<void> {
  const res = await fetch(`${API_URL}/api/latest/internal/mcp-review/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-hexclave-access-type": "client",
      "x-hexclave-project-id": PROJECT_ID,
      "x-hexclave-publishable-client-key": PUBLISHABLE_CLIENT_KEY,
      ...authHeaders,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MCP review API error (${res.status}): ${text}`);
  }
}

export function makeMcpReviewApi(authHeaders: Record<string, string>) {
  return {
    setReviewed: (body: { correlationId: string, reviewed: boolean }) =>
      post("set-reviewed", body, authHeaders),

    retryReview: (body: {
      correlationId: string;
      question: string;
      reason: string;
      response: string;
    }) => post("retry-review", body, authHeaders),

    updateCorrection: (body: {
      correlationId: string;
      correctedQuestion: string;
      correctedAnswer: string;
      publish: boolean;
    }) => post("update-correction", body, authHeaders),

    addManual: (body: {
      question: string;
      answer: string;
      publish: boolean;
      requestId: string;
    }) => post("add-manual", body, authHeaders),

    updateQaEntry: (body: {
      qaId: string;
      question: string;
      answer: string;
      publish: boolean;
    }) => post("update-qa-entry", body, authHeaders),

    delete: (body: { qaId: string }) =>
      post("delete", body, authHeaders),
  };
}

export async function requestSpacetimeBrowserSession(
  body: { cachedIdentity?: string },
  authHeaders: Record<string, string>,
): Promise<SpacetimeBrowserSessionResponse> {
  const res = await fetch(`${API_URL}/api/latest/internal/spacetimedb-browser-session`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-hexclave-access-type": "client",
      "x-hexclave-project-id": PROJECT_ID,
      "x-hexclave-publishable-client-key": PUBLISHABLE_CLIENT_KEY,
      ...authHeaders,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`SpacetimeDB browser session error (${res.status}): ${text}`);
  }
  return parseSpacetimeBrowserSessionResponse(await res.json());
}
