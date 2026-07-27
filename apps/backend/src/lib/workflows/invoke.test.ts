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

  test("keeps the fallback sandbox alive beyond the engine backstop", async () => {
    const result = await invokeWorkflowSandbox({
      compiledBundle: "export default async () => ({ status: 'ok' });",
      input,
      nodeModules: {},
      timeoutMs: 630_000,
    });

    expect(result.status).toBe("ok");
    expect(executeJavascriptMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ executionTimeoutMs: 660_000 }),
    );
  });
});
