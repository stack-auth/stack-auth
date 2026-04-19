const IS_DEV = process.env.NODE_ENV === "development";
const PLACEHOLDER = "REPLACE_ME";

function envOrDevDefault(value: string | undefined, devDefault: string): string {
  if (!value || value === PLACEHOLDER) {
    return IS_DEV ? devDefault : "";
  }
  return value;
}

const PORT_PREFIX = process.env.NEXT_PUBLIC_STACK_PORT_PREFIX ?? "81";
const API_URL = envOrDevDefault(process.env.NEXT_PUBLIC_STACK_API_URL, `http://localhost:${PORT_PREFIX}02`);
const PROJECT_ID = envOrDevDefault(process.env.NEXT_PUBLIC_STACK_PROJECT_ID, "internal");
const PUBLISHABLE_CLIENT_KEY = envOrDevDefault(
  process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY,
  "this-publishable-client-key-is-for-local-development-only",
);

async function post(path: string, body: unknown, authHeaders: Record<string, string>): Promise<void> {
  const res = await fetch(`${API_URL}/api/latest/internal/mcp-review/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-stack-access-type": "client",
      "x-stack-project-id": PROJECT_ID,
      "x-stack-publishable-client-key": PUBLISHABLE_CLIENT_KEY,
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
    markReviewed: (body: { correlationId: string }) =>
      post("mark-reviewed", body, authHeaders),

    unmarkReviewed: (body: { correlationId: string }) =>
      post("unmark-reviewed", body, authHeaders),

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
    }) => post("add-manual", body, authHeaders),

    delete: (body: { correlationId: string }) =>
      post("delete", body, authHeaders),
  };
}

export async function enrollSpacetimeReviewer(
  body: { identity: string },
  authHeaders: Record<string, string>,
): Promise<void> {
  const res = await fetch(`${API_URL}/api/latest/internal/spacetimedb-enroll-reviewer`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-stack-access-type": "client",
      "x-stack-project-id": PROJECT_ID,
      "x-stack-publishable-client-key": PUBLISHABLE_CLIENT_KEY,
      ...authHeaders,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`SpacetimeDB enroll error (${res.status}): ${text}`);
  }
}
