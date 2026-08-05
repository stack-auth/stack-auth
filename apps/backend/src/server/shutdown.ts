export type BackendShutdownDependencies = {
  stopAcceptingRequests: () => Promise<unknown>,
  drainBackgroundTasks: () => Promise<unknown>,
  disconnectDatabases: () => Promise<unknown>,
  closeInstrumentation: () => Promise<unknown>,
  log: (event: BackendShutdownLogEvent) => void,
};

// Cloud Run and Docker commonly allow ten seconds between SIGTERM and SIGKILL.
// Exit one second earlier so the process, rather than the platform, owns the
// terminal log and exit code when an in-flight request or dependency hangs.
// Every step is individually bounded so one hanging step (most plausibly the
// HTTP close waiting on a long-running request) cannot starve the later steps
// out of the budget — draining background tasks and flushing the database and
// instrumentation matters more than waiting longer for a request the platform
// is about to kill anyway.
export const backendShutdownBudget = {
  httpServerTimeoutMs: 2000,
  backgroundTasksTimeoutMs: 4000,
  databaseTimeoutMs: 1000,
  instrumentationTimeoutMs: 1000,
  hardExitTimeoutMs: 9000,
  platformGracePeriodMs: 10000,
};

export type BackendShutdownLogEvent = {
  event: "backend.shutdown.started" | "backend.shutdown.completed" | "backend.shutdown.failed",
  signal: NodeJS.Signals,
  durationMs?: number,
  failedSteps?: string[],
};

type ShutdownStep = {
  name: string,
  run: () => Promise<unknown>,
};

export async function runShutdownOperationWithTimeout<T>(
  operationName: string,
  timeoutMs: number,
  operation: () => Promise<T>,
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`${operationName} did not complete within ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation(), timeoutPromise]);
  } finally {
    if (timeout != null) {
      clearTimeout(timeout);
    }
  }
}

async function runShutdownStep(step: ShutdownStep) {
  const [result] = await Promise.allSettled([Promise.resolve().then(step.run)]);
  return {
    name: step.name,
    result,
  };
}

/**
 * Stops ingress first, then drains resources in dependency order. Each phase uses
 * allSettled so one broken cleanup path cannot prevent telemetry from reporting it.
 */
export async function shutdownBackend(
  signal: NodeJS.Signals,
  dependencies: BackendShutdownDependencies,
): Promise<void> {
  const startedAt = performance.now();
  dependencies.log({
    event: "backend.shutdown.started",
    signal,
  });

  const results = [
    await runShutdownStep({
      name: "http-server",
      run: dependencies.stopAcceptingRequests,
    }),
    await runShutdownStep({
      name: "background-tasks",
      run: dependencies.drainBackgroundTasks,
    }),
    await runShutdownStep({
      name: "databases",
      run: dependencies.disconnectDatabases,
    }),
    await runShutdownStep({
      name: "instrumentation",
      run: dependencies.closeInstrumentation,
    }),
  ];
  const failures = results.filter((entry) => entry.result.status === "rejected");

  if (failures.length > 0) {
    const failedSteps = failures.map((entry) => entry.name);
    dependencies.log({
      event: "backend.shutdown.failed",
      signal,
      durationMs: performance.now() - startedAt,
      failedSteps,
    });
    throw new AggregateError(
      failures.map((entry) => entry.result.status === "rejected" ? entry.result.reason : undefined),
      `Backend shutdown failed in: ${failedSteps.join(", ")}`,
    );
  }

  dependencies.log({
    event: "backend.shutdown.completed",
    signal,
    durationMs: performance.now() - startedAt,
  });
}
