import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequestCompletionLog } from "./request-log";

describe("createRequestCompletionLog", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("logs a normalized path and response request ID without dynamic IDs or query data", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "abc123");
    vi.stubEnv("VERCEL_REGION", "iad1");
    const response = new Response(null, {
      status: 201,
      headers: {
        "x-hexclave-request-id": "request-123",
      },
    });

    const result = createRequestCompletionLog({
      request: new Request("https://api.example.com/api/latest/users/user-secret?secret=do-not-log", {
        method: "POST",
      }),
      response,
      fallbackStatus: 200,
      startedAt: performance.now(),
      normalizedPath: "/api/latest/users/[user_id]",
    });

    expect(result).toMatchObject({
      event: "backend.request.completed",
      service: "stack-backend",
      method: "POST",
      path: "/api/latest/users/[user_id]",
      status: 201,
      requestId: "request-123",
      environment: "production",
      commit: "abc123",
      region: "iad1",
    });
    expect(JSON.stringify(result)).not.toContain("user-secret");
    expect(JSON.stringify(result)).not.toContain("do-not-log");
  });
});
