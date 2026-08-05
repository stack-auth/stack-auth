import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { executeJavascriptMock } = vi.hoisted(() => ({
  executeJavascriptMock: vi.fn(),
}));

vi.mock("@/lib/js-execution", () => ({
  executeJavascript: executeJavascriptMock,
}));

import {
  BRAIN_JAVASCRIPT_MAX_BATCH_SIZE,
  BRAIN_JAVASCRIPT_MAX_CODE_BYTES,
  BRAIN_JAVASCRIPT_MAX_MEMORY_BYTES,
  executeBrainJavascript,
  type BrainJavascriptQueueItem,
} from "./javascript";

const items: BrainJavascriptQueueItem[] = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    type: "user.signed_up",
    schemaVersion: 1,
    payload: { user_id: "user-1" },
    occurredAt: "2026-08-04T00:00:00.000Z",
    subjectType: "user",
    subjectId: "user-1",
    attempts: 1,
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    type: "email.sent",
    schemaVersion: 1,
    payload: { recipient_count: 2 },
    occurredAt: "2026-08-04T00:01:00.000Z",
    subjectType: "email_outbox",
    subjectId: "email-1",
    attempts: 1,
  },
];

async function executeGeneratedModule(code: string) {
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
  const generatedModule = await import(moduleUrl);
  return await generatedModule.default();
}

describe("executeBrainJavascript", () => {
  beforeEach(() => {
    executeJavascriptMock.mockReset();
    executeJavascriptMock.mockImplementation(executeGeneratedModule);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("provides batched queue operations and durable memory", async () => {
    const outcome = await executeBrainJavascript({
      items,
      memory: { existing: { strategy: "manual" } },
      code: `
        const signups = brain.fetch({ types: ["user.signed_up"], limit: 10 });
        brain.acknowledge(signups.map((item) => item.id));
        const emails = brain.fetch({ limit: 10 });
        brain.release(emails.map((item) => item.id), { error: "retry later", retryDelayMs: 5000 });
        brain.remember("signup-playbook", { batchSize: 100 });
        return { signupCount: signups.length, previous: brain.recall("existing") };
      `,
    });

    expect(outcome.result).toEqual({
      signupCount: 1,
      previous: { strategy: "manual" },
    });
    expect(outcome.actions).toEqual([
      {
        type: "acknowledge",
        ids: ["00000000-0000-4000-8000-000000000001"],
      },
      {
        type: "release",
        ids: ["00000000-0000-4000-8000-000000000002"],
        error: "retry later",
        fail: false,
      },
    ]);
    expect(outcome.memory).toEqual({
      existing: { strategy: "manual" },
      "signup-playbook": { batchSize: 100 },
    });
    expect(outcome.protocolVersion).toBe(1);
    expect(executeJavascriptMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        disableSanityTest: true,
        executionTimeoutMs: 35_000,
        nodeModules: {},
      }),
    );
  });

  it("rejects queue actions outside the automatically claimed batch", async () => {
    await expect(executeBrainJavascript({
      items,
      memory: {},
      code: `
        brain.acknowledge(["00000000-0000-4000-8000-000000000099"]);
      `,
    })).rejects.toThrow("Brain JavaScript execution failed");
  });

  it("rejects duplicate finalization even across action types", async () => {
    await expect(executeBrainJavascript({
      items,
      memory: {},
      code: `
        brain.acknowledge(["00000000-0000-4000-8000-000000000001"]);
        brain.release(["00000000-0000-4000-8000-000000000001"]);
      `,
    })).rejects.toThrow("Brain JavaScript execution failed");
  });

  it("supports explicit failures and memory deletion", async () => {
    const outcome = await executeBrainJavascript({
      items,
      memory: { obsolete: true, retained: { version: 1 } },
      code: `
        const [first] = brain.fetch({ limit: 1 });
        brain.fail([first.id], "unrecoverable");
        brain.forget("obsolete");
        return brain.recall();
      `,
    });

    expect(outcome.actions).toEqual([{
      type: "release",
      ids: ["00000000-0000-4000-8000-000000000001"],
      error: "unrecoverable",
      fail: true,
    }]);
    expect(outcome.memory).toEqual({ retained: { version: 1 } });
    expect(outcome.result).toEqual({ retained: { version: 1 } });
  });

  it("preserves __proto__ payload keys as inert data", async () => {
    const payload = JSON.parse('{"__proto__":{"polluted":true}}');
    const outcome = await executeBrainJavascript({
      items: [{ ...items[0], payload }],
      memory: {},
      code: `
        const [item] = brain.fetch();
        brain.acknowledge([item.id]);
        return {
          payloadValue: item.payload["__proto__"].polluted,
          globalValue: Object.prototype.polluted,
        };
      `,
    });

    expect(outcome.result).toEqual({ payloadValue: true });
    expect(Object.prototype).not.toHaveProperty("polluted");
  });

  it("reports items that a manual script has not processed yet", async () => {
    const outcome = await executeBrainJavascript({
      items,
      memory: {},
      code: `
        const [first] = brain.fetch({ limit: 1 });
        brain.acknowledge([first.id]);
        return brain.stats();
      `,
    });

    expect(outcome.result).toEqual({
      supplied: 2,
      fetched: 1,
      acknowledged: 1,
      released: 0,
      untouched: 1,
    });
  });

  it("enforces a caller-side timeout for every execution provider", async () => {
    vi.useFakeTimers();
    executeJavascriptMock.mockReturnValue(new Promise(() => {}));

    const execution = executeBrainJavascript({
      items,
      memory: {},
      code: "return null;",
    });
    const assertion = expect(execution).rejects.toThrow("Brain JavaScript execution timed out");
    await vi.advanceTimersByTimeAsync(30_000);

    await assertion;
  });

  it("rejects oversized results after provider execution", async () => {
    executeJavascriptMock.mockResolvedValue({
      status: "ok",
      data: {
        protocolVersion: 1,
        result: "x".repeat(1024 * 1024 + 1),
        actions: [],
        memory: {},
      },
    });

    await expect(executeBrainJavascript({
      items: [],
      memory: {},
      code: "return null;",
    })).rejects.toThrow("Brain JavaScript result exceeded the size limit");
  });

  it("rejects malformed provider results", async () => {
    executeJavascriptMock.mockResolvedValue({
      status: "ok",
      data: { protocolVersion: 1, actions: "not-an-array", memory: {} },
    });

    await expect(executeBrainJavascript({
      items: [],
      memory: {},
      code: "return null;",
    })).rejects.toThrow("Brain JavaScript returned a malformed result");
  });

  it("enforces code, item-count, and initial-memory limits before execution", async () => {
    await expect(executeBrainJavascript({
      items: [],
      memory: {},
      code: "x".repeat(BRAIN_JAVASCRIPT_MAX_CODE_BYTES + 1),
    })).rejects.toThrow("code-size limit");

    await expect(executeBrainJavascript({
      items: Array.from({ length: BRAIN_JAVASCRIPT_MAX_BATCH_SIZE + 1 }, () => items[0]),
      memory: {},
      code: "return null;",
    })).rejects.toThrow("queue-batch item limit");

    await expect(executeBrainJavascript({
      items: [],
      memory: { oversized: "x".repeat(BRAIN_JAVASCRIPT_MAX_MEMORY_BYTES) },
      code: "return null;",
    })).rejects.toThrow("memory exceeded the size limit");

    expect(executeJavascriptMock).not.toHaveBeenCalled();
  });
});
