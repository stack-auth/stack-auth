import { beforeEach, describe, expect, test, vi } from "vitest";
import { WORKFLOWS_PROTOCOL_VERSION, type WorkflowSandboxInput } from "./protocol";

const { executeJavascriptMock } = vi.hoisted(() => ({
  executeJavascriptMock: vi.fn(),
}));

vi.mock("@/lib/js-execution", () => ({
  executeJavascript: executeJavascriptMock,
}));

import { invokeWorkflowSandbox } from "./invoke";

const input: WorkflowSandboxInput = {
  protocolVersion: WORKFLOWS_PROTOCOL_VERSION,
  mode: "manifest",
  limits: {
    stepResultMaxBytes: 1,
    defaultStepTimeoutMs: 1,
    maxStepTimeoutMs: 1,
    logsMaxBytes: 1,
    inlineSleepMaxMs: 1,
    inlineSleepBudgetMs: 1,
  },
};

describe("invokeWorkflowSandbox", () => {
  beforeEach(() => {
    executeJavascriptMock.mockReset();
    executeJavascriptMock.mockResolvedValue({
      status: "ok",
      data: {
        type: "manifest",
        manifest: {
          workflowId: "timeout-test",
          triggers: [],
          hasRunKey: false,
          onConflict: "skip",
        },
      },
    });
  });

  test("gives providers the same ceiling as the engine backstop", async () => {
    const result = await invokeWorkflowSandbox({
      compiledBundle: "export default async () => ({ status: 'ok' });",
      input,
      nodeModules: {},
      timeoutMs: 630_000,
    });

    expect(result.status).toBe("ok");
    expect(executeJavascriptMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ executionTimeoutMs: 630_000 }),
    );
  });

  test("propagates request cancellation into sandbox execution", async () => {
    const controller = new AbortController();
    const cancellation = new Error("route deadline reached");
    executeJavascriptMock.mockImplementation(async (
      _code: string,
      executionOptions: { signal?: AbortSignal },
    ) => await new Promise((_, reject) => {
      const signal = executionOptions.signal;
      if (signal == null) {
        reject(new Error("Expected workflow execution to receive a signal"));
        return;
      }
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }));

    const invocation = invokeWorkflowSandbox({
      compiledBundle: "export default async () => ({ status: 'ok' });",
      input,
      nodeModules: {},
      timeoutMs: 60_000,
      signal: controller.signal,
    });
    controller.abort(cancellation);

    await expect(invocation).rejects.toBe(cancellation);
  });
});
