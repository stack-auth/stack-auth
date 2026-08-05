export type BackendShutdownDependencies = {
  stopAcceptingRequests: () => Promise<unknown>,
  drainBackgroundTasks: () => Promise<unknown>,
  disconnectDatabases: () => Promise<unknown>,
  closeInstrumentation: () => Promise<unknown>,
  log: (event: BackendShutdownLogEvent) => void,
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
