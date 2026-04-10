const API_URL = process.env.NEXT_PUBLIC_STACK_API_URL;
const PROJECT_ID = process.env.NEXT_PUBLIC_STACK_PROJECT_ID;
const PUBLISHABLE_CLIENT_KEY = process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY;

async function post(path: string, body: unknown): Promise<void> {
  const res = await fetch(`${API_URL}/api/latest/internal/mcp-review/${path}`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "x-stack-access-type": "client",
      "x-stack-project-id": PROJECT_ID ?? "",
      "x-stack-publishable-client-key": PUBLISHABLE_CLIENT_KEY ?? "",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MCP review API error (${res.status}): ${text}`);
  }
}

export const mcpReviewApi = {
  markReviewed: (body: { correlationId: string; reviewedBy: string }) =>
    post("mark-reviewed", body),

  updateCorrection: (body: {
    correlationId: string;
    correctedQuestion: string;
    correctedAnswer: string;
    publish: boolean;
    reviewedBy: string;
  }) => post("update-correction", body),

  addManual: (body: {
    question: string;
    answer: string;
    publish: boolean;
    reviewedBy: string;
  }) => post("add-manual", body),

  delete: (body: { correlationId: string }) =>
    post("delete", body),
};
