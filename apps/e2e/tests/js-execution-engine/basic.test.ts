import { beforeAll, describe, expect, it } from "vitest";

const JS_EXECUTION_ENGINE_URL = "http://localhost:8124";
const JS_EXECUTION_ENGINE_SECRET = "dev-secret-placeholder-123456";

describe("JS Execution Engine - Basic functionality", () => {
  beforeAll(async () => {
    // Wait for service to be ready
    const maxRetries = 30;
    for (let i = 0; i < maxRetries; i++) {
      try {
        const response = await fetch(`${JS_EXECUTION_ENGINE_URL}/health`, {
          headers: {
            Authorization: `Bearer ${JS_EXECUTION_ENGINE_SECRET}`,
          },
        });
        if (response.ok) break;
      } catch {
        // Service not ready yet
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  });

  it("should reject requests without authentication", async () => {
    const response = await fetch(`${JS_EXECUTION_ENGINE_URL}/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        script: "return 1 + 1;",
        engine: "quickjs",
      }),
    });

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toMatchInlineSnapshot(`
      {
        "error": "Unauthorized",
      }
    `);
  });

  it("should reject requests with invalid authentication", async () => {
    const response = await fetch(`${JS_EXECUTION_ENGINE_URL}/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer invalid-secret",
      },
      body: JSON.stringify({
        script: "return 1 + 1;",
        engine: "quickjs",
      }),
    });

    expect(response.status).toBe(401);
  });

  it("should execute a simple QuickJS script", async () => {
    const response = await fetch(`${JS_EXECUTION_ENGINE_URL}/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${JS_EXECUTION_ENGINE_SECRET}`,
      },
      body: JSON.stringify({
        script: "return 1 + 1;",
        engine: "quickjs",
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result).toBe(2);
    expect(body.checkpoint_storage_id).toBeTypeOf("string");
    expect(body.checkpoint_byte_length).toBeGreaterThan(0);
  });

  it("should execute a simple Node.js script", async () => {
    const response = await fetch(`${JS_EXECUTION_ENGINE_URL}/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${JS_EXECUTION_ENGINE_SECRET}`,
      },
      body: JSON.stringify({
        script: "return 2 + 2;",
        engine: "nodejs",
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result).toBe(4);
    expect(body.checkpoint_storage_id).toBeTypeOf("string");
    expect(body.checkpoint_byte_length).toBeGreaterThan(0);
  });

  it("should execute a simple Hermes script", async () => {
    const response = await fetch(`${JS_EXECUTION_ENGINE_URL}/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${JS_EXECUTION_ENGINE_SECRET}`,
      },
      body: JSON.stringify({
        script: "return 3 + 3;",
        engine: "hermes",
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result).toBe(6);
    expect(body.checkpoint_storage_id).toBeTypeOf("string");
    expect(body.checkpoint_byte_length).toBeGreaterThan(0);
  });

  it("should validate request body", async () => {
    const response = await fetch(`${JS_EXECUTION_ENGINE_URL}/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${JS_EXECUTION_ENGINE_SECRET}`,
      },
      body: JSON.stringify({
        script: "return 1 + 1;",
        engine: "invalid-engine",
      }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Invalid request");
    expect(body.details).toBeDefined();
  });

  it("should handle missing script field", async () => {
    const response = await fetch(`${JS_EXECUTION_ENGINE_URL}/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${JS_EXECUTION_ENGINE_SECRET}`,
      },
      body: JSON.stringify({
        engine: "quickjs",
      }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Invalid request");
  });

  it("should handle missing engine field", async () => {
    const response = await fetch(`${JS_EXECUTION_ENGINE_URL}/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${JS_EXECUTION_ENGINE_SECRET}`,
      },
      body: JSON.stringify({
        script: "return 1 + 1;",
      }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Invalid request");
  });
});
