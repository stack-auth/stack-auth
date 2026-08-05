import {
  ROUTE_DRAIN_GRACE_MS,
  ROUTE_TERMINATION_BUFFER_MS,
  validateRouteMaxDurationSeconds,
} from "./runtime-limits";

type PromiseOutcome<T> =
  | { status: "fulfilled", value: T }
  | { status: "rejected", reason: unknown };

type RequestLifetimeOptions = {
  drainGraceMs: number,
  maxDurationMs: number,
  normalizedPath: string,
  startedAt: number,
  terminationBufferMs: number,
};

export class RouteTimeoutError extends Error {
  constructor(
    public readonly normalizedPath: string,
    public readonly maxDurationMs: number,
  ) {
    super(`Route ${normalizedPath} exceeded its ${maxDurationMs}ms execution budget.`);
    this.name = "RouteTimeoutError";
  }
}

function observePromise<T>(promise: Promise<T>): Promise<PromiseOutcome<T>> {
  return promise.then(
    (value) => ({ status: "fulfilled", value }),
    (reason: unknown) => ({ status: "rejected", reason }),
  );
}

/**
 * Owns cancellation for one logical route invocation. Fluid Compute can run
 * unrelated invocations in the same process, so this deliberately never stops
 * the Elysia server or drains the process-global task set.
 */
export class RequestLifetime {
  private readonly abortController = new AbortController();
  private readonly backgroundTasks = new Set<Promise<unknown>>();
  private readonly cancellationDeadline: number;
  private readonly hardDeadline: number;
  private readonly timeoutError: RouteTimeoutError;
  private readonly timeoutPromise: Promise<RouteTimeoutError>;
  private disposed = false;
  private handlerCompleted = false;
  private resolveTimeout: (error: RouteTimeoutError) => void = () => {};
  private timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly options: RequestLifetimeOptions) {
    if (options.maxDurationMs <= options.drainGraceMs + options.terminationBufferMs) {
      throw new Error(`Route ${options.normalizedPath} max duration does not leave time to drain.`);
    }
    this.hardDeadline = options.startedAt + options.maxDurationMs - options.terminationBufferMs;
    this.timeoutError = new RouteTimeoutError(options.normalizedPath, options.maxDurationMs);
    this.timeoutPromise = new Promise((resolve) => {
      this.resolveTimeout = resolve;
    });
    this.cancellationDeadline = this.hardDeadline - options.drainGraceMs;
    const remainingMs = this.cancellationDeadline - performance.now();
    if (remainingMs <= 0) {
      this.startCancellation();
    } else {
      this.timeoutHandle = setTimeout(() => this.startCancellation(), remainingMs);
    }
  }

  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  async runHandler<T>(handler: (signal: AbortSignal) => Promise<T>): Promise<T> {
    // setTimeout(0) runs after promise microtasks. Check synchronously so a
    // request whose route budget was consumed during routing/import never gets
    // one extra handler turn before cancellation starts.
    if (this.signal.aborted) {
      this.handlerCompleted = true;
      this.disposeIfComplete();
      throw this.timeoutError;
    }
    const handlerPromise = Promise.resolve().then(() => handler(this.signal));
    const outcome = await Promise.race([
      observePromise(handlerPromise),
      this.timeoutPromise.then((error) => ({ status: "timed-out" as const, error })),
    ]);

    this.handlerCompleted = true;
    // A CPU-bound handler can delay the timer callback beyond the cancellation
    // boundary. Elapsed time is authoritative even when the event loop did not
    // get a chance to deliver the timer first.
    if (outcome.status === "timed-out" || performance.now() >= this.cancellationDeadline) {
      this.startCancellation();
      await this.drainUntilHardDeadline([handlerPromise]);
      this.disposeIfComplete();
      throw this.timeoutError;
    }

    this.disposeIfComplete();
    if (outcome.status === "rejected") {
      throw outcome.reason;
    }
    return outcome.value;
  }

  /**
   * Keeps the logical route alive until a streaming response closes. Once the
   * deadline fires, cancel the upstream body and error the client-visible stream;
   * headers may already be committed, so a mid-stream timeout cannot become a 504.
   */
  ownResponse(response: Response): Response {
    if (response.body == null) {
      return response;
    }
    if (this.disposed) {
      throw new Error(`Route ${this.options.normalizedPath} tried to stream after its request lifetime ended.`);
    }

    const reader = response.body.getReader();
    let finishStream: () => void = () => {};
    const completion = new Promise<void>((resolve) => {
      finishStream = resolve;
    });
    this.backgroundTasks.add(completion);
    completion.then(
      () => this.completeBackgroundTask(completion),
      () => this.completeBackgroundTask(completion),
    );

    let finished = false;
    let hardDeadlineHandle: ReturnType<typeof setTimeout> | undefined;
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const finish = () => {
      if (finished) return;
      finished = true;
      this.signal.removeEventListener("abort", abortStream);
      if (hardDeadlineHandle != null) {
        clearTimeout(hardDeadlineHandle);
      }
      finishStream();
    };
    const abortStream = () => {
      if (finished) return;
      try {
        streamController?.error(this.timeoutError);
      } catch {
        // The consumer may have closed the controller in the same turn.
      }
      observePromise(Promise.resolve(reader.cancel(this.timeoutError))).then(finish, finish);
      hardDeadlineHandle = setTimeout(finish, Math.max(0, this.hardDeadline - performance.now()));
    };

    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        streamController = controller;
        this.signal.addEventListener("abort", abortStream, { once: true });
        if (this.signal.aborted) {
          abortStream();
        }
      },
      pull: async (controller) => {
        try {
          const chunk = await reader.read();
          if (finished) return;
          if (chunk.done) {
            controller.close();
            finish();
          } else {
            controller.enqueue(chunk.value);
          }
        } catch (error) {
          if (!finished) {
            try {
              controller.error(error);
            } finally {
              finish();
            }
          }
        }
      },
      cancel: async (reason) => {
        try {
          await reader.cancel(reason);
        } finally {
          finish();
        }
      },
    });

    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  /**
   * Returns the promise Vercel should own through waitUntil. After cancellation,
   * it gives the original task the remaining drain window, then releases the
   * invocation even if third-party code ignored the AbortSignal.
   */
  trackBackgroundTask<T>(promise: Promise<T>): Promise<T> {
    if (this.disposed) {
      throw new Error(`Route ${this.options.normalizedPath} registered background work after its request lifetime ended.`);
    }
    this.backgroundTasks.add(promise);
    promise.then(
      () => this.completeBackgroundTask(promise),
      () => this.completeBackgroundTask(promise),
    );

    return this.ownBackgroundTask(promise);
  }

  private async ownBackgroundTask<T>(promise: Promise<T>): Promise<T> {
    const outcome = await Promise.race([
      observePromise(promise),
      this.timeoutPromise.then((error) => ({ status: "timed-out" as const, error })),
    ]);
    if (outcome.status === "timed-out") {
      const drained = await this.drainUntilHardDeadline([promise]);
      if (!drained) {
        throw outcome.error;
      }
      const drainedOutcome = await observePromise(promise);
      if (drainedOutcome.status === "rejected") {
        throw drainedOutcome.reason;
      }
      return drainedOutcome.value;
    }
    if (outcome.status === "rejected") {
      throw outcome.reason;
    }
    return outcome.value;
  }

  private completeBackgroundTask(promise: Promise<unknown>) {
    this.backgroundTasks.delete(promise);
    this.disposeIfComplete();
  }

  private startCancellation() {
    if (this.signal.aborted) return;
    this.abortController.abort(this.timeoutError);
    this.resolveTimeout(this.timeoutError);
  }

  private async drainUntilHardDeadline(additionalPromises: Promise<unknown>[]): Promise<boolean> {
    const additional = new Set(additionalPromises);
    while (additional.size > 0 || this.backgroundTasks.size > 0) {
      const remainingMs = this.hardDeadline - performance.now();
      if (remainingMs <= 0) {
        return false;
      }
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      const settled = await Promise.race([
        Promise.allSettled([...additional, ...this.backgroundTasks]).then(() => true),
        new Promise<false>((resolve) => {
          timeoutHandle = setTimeout(() => resolve(false), remainingMs);
        }),
      ]);
      if (timeoutHandle != null) {
        clearTimeout(timeoutHandle);
      }
      if (!settled) {
        return false;
      }
      additional.clear();
    }
    return true;
  }

  private disposeIfComplete() {
    if (this.disposed || !this.handlerCompleted || this.backgroundTasks.size > 0) {
      return;
    }
    this.disposed = true;
    if (this.timeoutHandle != null) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = undefined;
    }
  }
}

export function createRequestLifetime(input: {
  maxDurationSeconds: number,
  normalizedPath: string,
  startedAt: number,
}): RequestLifetime {
  const maxDurationSeconds = validateRouteMaxDurationSeconds(input.maxDurationSeconds, input.normalizedPath);
  return new RequestLifetime({
    drainGraceMs: ROUTE_DRAIN_GRACE_MS,
    maxDurationMs: maxDurationSeconds * 1000,
    normalizedPath: input.normalizedPath,
    startedAt: input.startedAt,
    terminationBufferMs: ROUTE_TERMINATION_BUFFER_MS,
  });
}
