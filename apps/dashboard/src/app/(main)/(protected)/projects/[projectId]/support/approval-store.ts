/**
 * Bridges the mock copilot adapter (which pauses mid-stream awaiting an
 * approval) and the approval card rendered inside the assistant-ui thread.
 */
const resolvers = new Map<string, (approved: boolean) => void>();

export function waitForApproval(approvalId: string, abortSignal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    const settle = (approved: boolean) => {
      resolvers.delete(approvalId);
      resolve(approved);
    };
    resolvers.set(approvalId, settle);
    abortSignal.addEventListener("abort", () => settle(false), { once: true });
  });
}

export function resolveApproval(approvalId: string, approved: boolean): void {
  resolvers.get(approvalId)?.(approved);
}
