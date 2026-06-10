import type { ChildProcess } from "child_process";

type ForwardSignalsOptions = {
  processGroup?: boolean,
  forceKillAfterMs?: number,
};

function signalChild(child: ChildProcess, signal: NodeJS.Signals, options: ForwardSignalsOptions): void {
  if (child.pid == null) return;
  try {
    if (options.processGroup === true && process.platform !== "win32") {
      process.kill(-child.pid, signal);
    } else {
      child.kill(signal);
    }
  } catch {
    // best-effort
  }
}

// Forward SIGINT/SIGTERM from this process to a spawned child until the
// returned cleanup function is called (call it once the child has exited).
// Killing is best-effort: a child that already exited throws, which we ignore.
export function forwardSignals(child: ChildProcess, options: ForwardSignalsOptions = {}): () => void {
  let forceKillTimer: NodeJS.Timeout | undefined;
  const forward = (signal: NodeJS.Signals) => () => {
    signalChild(child, signal, options);
    if (options.forceKillAfterMs != null && forceKillTimer == null) {
      forceKillTimer = setTimeout(() => signalChild(child, "SIGKILL", options), options.forceKillAfterMs);
      forceKillTimer.unref();
    }
  };
  const onSigint = forward("SIGINT");
  const onSigterm = forward("SIGTERM");
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);
  return () => {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
    if (forceKillTimer != null) {
      clearTimeout(forceKillTimer);
    }
  };
}
