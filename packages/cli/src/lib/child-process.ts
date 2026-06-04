import type { ChildProcess } from "child_process";

// Forward SIGINT/SIGTERM from this process to a spawned child until the
// returned cleanup function is called (call it once the child has exited).
// Killing is best-effort: a child that already exited throws, which we ignore.
export function forwardSignals(child: ChildProcess): () => void {
  const forward = (signal: NodeJS.Signals) => () => {
    try {
      child.kill(signal);
    } catch {
      // best-effort
    }
  };
  const onSigint = forward("SIGINT");
  const onSigterm = forward("SIGTERM");
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);
  return () => {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
  };
}
