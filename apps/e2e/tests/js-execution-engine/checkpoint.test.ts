import { it, describe, expect, beforeAll } from "vitest";

const JS_EXECUTION_ENGINE_URL = "http://localhost:8124";
const JS_EXECUTION_ENGINE_SECRET = "dev-secret-placeholder-123456";

describe("JS Execution Engine - Checkpoint functionality", () => {
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

  it("should create and restore from checkpoint", async () => {
    // First execution - create initial state
    const firstResponse = await fetch(`${JS_EXECUTION_ENGINE_URL}/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${JS_EXECUTION_ENGINE_SECRET}`,
      },
      body: JSON.stringify({
        script: `
          global.counter = (global.counter || 0) + 1;
          return global.counter;
        `,
        engine: "nodejs",
      }),
    });

    expect(firstResponse.status).toBe(200);
    const firstBody = await firstResponse.json();
    expect(firstBody.result).toBe(1);
    expect(firstBody.checkpoint_storage_id).toBeTypeOf("string");
    expect(firstBody.checkpoint_byte_length).toBeGreaterThan(0);

    const checkpointId = firstBody.checkpoint_storage_id;

    // Second execution - restore from checkpoint and increment
    const secondResponse = await fetch(`${JS_EXECUTION_ENGINE_URL}/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${JS_EXECUTION_ENGINE_SECRET}`,
      },
      body: JSON.stringify({
        script: `
          global.counter = (global.counter || 0) + 1;
          return global.counter;
        `,
        engine: "nodejs",
        checkpoint_storage_id: checkpointId,
      }),
    });

    expect(secondResponse.status).toBe(200);
    const secondBody = await secondResponse.json();
    expect(secondBody.result).toBe(2);
    expect(secondBody.checkpoint_storage_id).toBeTypeOf("string");
  });

  it("should maintain state across checkpoint restores", async () => {
    // Initialize with some data
    const initResponse = await fetch(`${JS_EXECUTION_ENGINE_URL}/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${JS_EXECUTION_ENGINE_SECRET}`,
      },
      body: JSON.stringify({
        script: `
          global.data = {
            users: ["alice", "bob"],
            count: 2,
          };
          return global.data;
        `,
        engine: "nodejs",
      }),
    });

    expect(initResponse.status).toBe(200);
    const initBody = await initResponse.json();
    expect(initBody.result).toMatchInlineSnapshot(`
      {
        "count": 2,
        "users": [
          "alice",
          "bob",
        ],
      }
    `);

    const checkpointId = initBody.checkpoint_storage_id;

    // Modify the data using checkpoint
    const modifyResponse = await fetch(`${JS_EXECUTION_ENGINE_URL}/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${JS_EXECUTION_ENGINE_SECRET}`,
      },
      body: JSON.stringify({
        script: `
          global.data.users.push("charlie");
          global.data.count++;
          return global.data;
        `,
        engine: "nodejs",
        checkpoint_storage_id: checkpointId,
      }),
    });

    expect(modifyResponse.status).toBe(200);
    const modifyBody = await modifyResponse.json();
    expect(modifyBody.result).toMatchInlineSnapshot(`
      {
        "count": 3,
        "users": [
          "alice",
          "bob",
          "charlie",
        ],
      }
    `);
  });

  it("should handle invalid checkpoint ID gracefully", async () => {
    const response = await fetch(`${JS_EXECUTION_ENGINE_URL}/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${JS_EXECUTION_ENGINE_SECRET}`,
      },
      body: JSON.stringify({
        script: "return 42;",
        engine: "quickjs",
        checkpoint_storage_id: "non-existent-checkpoint-id",
      }),
    });

    // Should still execute, just without the checkpoint
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result).toBe(42);
  });

  it("should create separate checkpoints for different engines", async () => {
    const engines = ["quickjs", "nodejs", "hermes"] as const;
    const checkpoints: Record<string, string> = {};

    for (const engine of engines) {
      const response = await fetch(`${JS_EXECUTION_ENGINE_URL}/execute`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${JS_EXECUTION_ENGINE_SECRET}`,
        },
        body: JSON.stringify({
          script: `return "${engine}";`,
          engine,
        }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.result).toBe(engine);
      checkpoints[engine] = body.checkpoint_storage_id;
    }

    // Verify all checkpoint IDs are unique
    const uniqueCheckpoints = new Set(Object.values(checkpoints));
    expect(uniqueCheckpoints.size).toBe(engines.length);
  });
});
