/**
 * Opt-in host lifecycle delivery for server applications.
 *
 * The normal server integration deliberately uses `uncaughtExceptionMonitor`
 * so constructing an app cannot change Node's crash behavior. This module is
 * the explicit opt-in path for hosts which want one bounded delivery attempt
 * before a fatal error or termination signal is handed back to the host.
 *
 * The shape follows the pinned sentry-javascript Node integrations: capture the
 * first fatal signal, give the transport a finite shutdown window, and make
 * the ownership decision explicit. It never relies on an async EventEmitter
 * listener being awaited (Node does not await it), and every installed hook is
 * removed before host ownership is handed back.
 */

export type ServerLifecycleSignal = "uncaughtException" | "unhandledRejection" | "SIGTERM" | "SIGINT";

export type ServerLifecycleCaptureInfo = {
  signal: ServerLifecycleSignal,
};

export type ServerLifecycleDeliveryOutcome = {
  signal: ServerLifecycleSignal,
  outcome: "accepted" | "dropped",
  reason: "accepted" | "delivery_failed" | "deadline" | "duplicate",
};

export type ServerLifecycleHost = {
  on: (event: string, listener: (...args: unknown[]) => void) => unknown,
  removeListener: (event: string, listener: (...args: unknown[]) => void) => unknown,
  nextTick?: (callback: () => void) => unknown,
  exit?: (code: number) => unknown,
  kill?: (pid: number, signal: "SIGTERM" | "SIGINT") => unknown,
  pid?: number,
  /** Test/runtime seam. Production hosts receive this from `nextTick`. */
  rethrow?: (error: unknown) => void,
};

export type ServerLifecycleInstallOptions = {
  /** Stable app-owned key used to replace an older HMR generation. */
  ownerKey: string,
  capture: (error: unknown, info: ServerLifecycleCaptureInfo) => Promise<void> | void,
  flush: () => Promise<void>,
  /** @default 2000; bounded to 30 seconds so a host can never wait forever. */
  deadlineMs?: number,
  /** Host ownership rethrows after delivery; SDK ownership exits with code 1. */
  fatalErrorAction?: "rethrow" | "exit",
  /** Host ownership re-emits the signal; SDK ownership exits with 128 + signal number. */
  signalAction?: "reemit" | "exit",
  onOutcome?: (outcome: ServerLifecycleDeliveryOutcome) => void,
  /** Injectable host for tests; omitted uses the ambient process when supported. */
  host?: ServerLifecycleHost,
};

export type ServerLifecycleHandle = {
  readonly active: boolean,
  uninstall: () => void,
  /** Resolves after all handler-triggered delivery attempts have settled. */
  waitForIdle: () => Promise<void>,
};

const DEFAULT_DEADLINE_MS = 2_000;
const MAX_DEADLINE_MS = 30_000;
const SERVER_LIFECYCLE_REGISTRY_KEY = "__hexclaveServerLifecycleRegistry";

type ServerLifecycleUninstall = () => void;

type Registry = Map<string, ServerLifecycleUninstall>;

function isRegistry(value: unknown): value is Registry {
  if (!(value instanceof Map)) return false;
  for (const [key, uninstall] of value.entries()) {
    if (typeof key !== "string" || typeof uninstall !== "function") return false;
  }
  return true;
}

function getRegistry(): Registry {
  const existing = Reflect.get(globalThis, SERVER_LIFECYCLE_REGISTRY_KEY);
  if (isRegistry(existing)) return existing;
  const registry: Registry = new Map();
  Reflect.set(globalThis, SERVER_LIFECYCLE_REGISTRY_KEY, registry);
  return registry;
}

function getProcessHost(): ServerLifecycleHost | null {
  const candidate = Reflect.get(globalThis, "process");
  if (Object.is(candidate, null) || typeof candidate !== "object") return null;

  const on = Reflect.get(candidate, "on");
  const removeListener = Reflect.get(candidate, "removeListener");
  if (typeof on !== "function" || typeof removeListener !== "function") return null;

  const nextTickValue = Reflect.get(candidate, "nextTick");
  const exitValue = Reflect.get(candidate, "exit");
  const killValue = Reflect.get(candidate, "kill");
  const pidValue = Reflect.get(candidate, "pid");

  const nextTick = typeof nextTickValue === "function"
    ? (callback: () => void): unknown => Reflect.apply(nextTickValue, candidate, [callback])
    : undefined;
  const exit = typeof exitValue === "function"
    ? (code: number): unknown => Reflect.apply(exitValue, candidate, [code])
    : undefined;
  const kill = typeof killValue === "function"
    ? (pid: number, signal: "SIGTERM" | "SIGINT"): unknown => Reflect.apply(killValue, candidate, [pid, signal])
    : undefined;
  const pid = typeof pidValue === "number" && Number.isSafeInteger(pidValue) ? pidValue : undefined;

  const host: ServerLifecycleHost = {
    on: (event, listener) => Reflect.apply(on, candidate, [event, listener]),
    removeListener: (event, listener) => Reflect.apply(removeListener, candidate, [event, listener]),
    ...nextTick === undefined ? {} : { nextTick },
    ...exit === undefined ? {} : { exit },
    ...kill === undefined ? {} : { kill },
    ...pid === undefined ? {} : { pid },
    rethrow: (error) => {
      if (nextTick !== undefined) {
        nextTick(() => {
          throw error;
        });
        return;
      }
      if (exit !== undefined) {
        exit(1);
        return;
      }
      throw error;
    },
  };
  return host;
}

function normalizeDeadline(deadlineMs: number | undefined): number {
  const value = deadlineMs ?? DEFAULT_DEADLINE_MS;
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_DEADLINE_MS) {
    throw new Error(`Hexclave server lifecycle deadlineMs must be a positive integer no greater than ${MAX_DEADLINE_MS}`);
  }
  return value;
}

type DeadlineResult =
  | { status: "completed" }
  | { status: "failed", error: unknown }
  | { status: "timed_out" };

function settleWithinDeadline(work: () => Promise<void> | void, deadlineMs: number): Promise<DeadlineResult> {
  return new Promise<DeadlineResult>((resolve) => {
    let settled = false;
    // Deliberately NOT unref'd: this timer is the only GUARANTEED event-loop
    // handle for the shutdown window. Delivery work may await promises whose
    // only pending handles are themselves unref'd (OTel batch processors unref
    // their flush timers), and with an uncaughtException listener installed an
    // empty loop makes Node exit with code 0 — masking the crash and skipping
    // the handoffFatal/handoffSignal ownership decision entirely. Worst case
    // the referenced timer keeps an otherwise-done process alive for
    // deadlineMs (bounded at 30s), which is exactly the advertised contract.
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ status: "timed_out" });
    }, deadlineMs);

    const finish = (result: DeadlineResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const workPromise = Promise.resolve().then(work);
    workPromise.then(
      () => finish({ status: "completed" }),
      (error: unknown) => finish({ status: "failed", error }),
    );
  });
}

function emitOutcome(options: ServerLifecycleInstallOptions, outcome: ServerLifecycleDeliveryOutcome): void {
  if (options.onOutcome === undefined) return;
  try {
    options.onOutcome(outcome);
  } catch (error) {
    // An outcome observer is diagnostic plumbing. It must not change fatal
    // ownership or turn a successful shutdown attempt into another crash.
    console.warn("Hexclave analytics: server lifecycle outcome observer failed:", error);
  }
}

function signalExitCode(signal: "SIGTERM" | "SIGINT"): number {
  return signal === "SIGTERM" ? 128 + 15 : 128 + 2;
}

function handoffFatal(host: ServerLifecycleHost, error: unknown, action: "rethrow" | "exit"): void {
  if (action === "exit") {
    if (host.exit !== undefined) {
      host.exit(1);
      return;
    }
    throw error;
  }
  if (host.rethrow !== undefined) {
    host.rethrow(error);
    return;
  }
  if (host.nextTick !== undefined) {
    host.nextTick(() => {
      throw error;
    });
    return;
  }
  if (host.exit !== undefined) {
    host.exit(1);
    return;
  }
  throw error;
}

function handoffSignal(host: ServerLifecycleHost, signal: "SIGTERM" | "SIGINT", action: "reemit" | "exit"): void {
  const exitCode = signalExitCode(signal);
  if (action === "exit") {
    if (host.exit !== undefined) {
      host.exit(exitCode);
      return;
    }
    return;
  }

  if (host.kill !== undefined && host.pid !== undefined) {
    try {
      host.kill(host.pid, signal);
      return;
    } catch (error) {
      console.warn(`Hexclave analytics: failed to re-emit ${signal}; using exit fallback:`, error);
    }
  }
  host.exit?.(exitCode);
}

function removeListeners(
  host: ServerLifecycleHost,
  listeners: readonly [string, (...args: unknown[]) => void][],
): void {
  for (const [event, listener] of listeners) {
    try {
      host.removeListener(event, listener);
    } catch (error) {
      // Teardown is best effort at the host boundary; continue removing the
      // remaining hooks so one broken adapter cannot leak every listener.
      console.warn(`Hexclave analytics: failed to remove server lifecycle ${event} listener:`, error);
    }
  }
}

/**
 * Installs the explicit server lifecycle integration. Calling this function
 * does not happen as a constructor side effect; the owning server app or its
 * framework adapter must opt in. A second install for the same owner replaces
 * the previous generation, which keeps HMR and repeated instrumentation setup
 * from multiplying process listeners.
 */
export function installServerLifecycle(options: ServerLifecycleInstallOptions): ServerLifecycleHandle | null {
  const host = options.host ?? getProcessHost();
  if (host === null) return null;
  if (typeof options.ownerKey !== "string" || options.ownerKey === "") throw new Error("Hexclave server lifecycle ownerKey is required");

  const deadlineMs = normalizeDeadline(options.deadlineMs);
  const registry = getRegistry();
  registry.get(options.ownerKey)?.();

  let active = true;
  let terminalTask: Promise<void> | null = null;
  const pending = new Set<Promise<void>>();
  const listeners: [string, (...args: unknown[]) => void][] = [];

  const detach = (): void => {
    if (!active) return;
    active = false;
    removeListeners(host, listeners);
    listeners.length = 0;
    if (registry.get(options.ownerKey) === uninstall) registry.delete(options.ownerKey);
  };

  const track = (task: Promise<void>): void => {
    pending.add(task);
    task.then(
      () => pending.delete(task),
      () => pending.delete(task),
    );
  };

  const deliver = async (signal: ServerLifecycleSignal, error: unknown): Promise<ServerLifecycleDeliveryOutcome> => {
    const result = await settleWithinDeadline(
      async () => {
        await options.capture(error, { signal });
        await options.flush();
      },
      deadlineMs,
    );
    if (result.status === "completed") {
      return { signal, outcome: "accepted", reason: "accepted" };
    }
    if (result.status === "timed_out") {
      return { signal, outcome: "dropped", reason: "deadline" };
    }
    return { signal, outcome: "dropped", reason: "delivery_failed" };
  };

  const duplicate = (signal: ServerLifecycleSignal): void => {
    emitOutcome(options, { signal, outcome: "dropped", reason: "duplicate" });
  };

  const beginFatal = (signal: "uncaughtException" | "unhandledRejection", error: unknown): void => {
    if (terminalTask !== null) {
      duplicate(signal);
      handoffFatal(host, error, options.fatalErrorAction ?? "rethrow");
      return;
    }

    terminalTask = deliver(signal, error).then((outcome) => {
      emitOutcome(options, outcome);
      detach();
      handoffFatal(host, error, options.fatalErrorAction ?? "rethrow");
    }, (deliveryError) => {
      emitOutcome(options, { signal, outcome: "dropped", reason: "delivery_failed" });
      detach();
      console.warn(`Hexclave analytics: failed to deliver ${signal} lifecycle event:`, deliveryError);
      handoffFatal(host, error, options.fatalErrorAction ?? "rethrow");
    });
    track(terminalTask);
  };

  const beginSignal = (signal: "SIGTERM" | "SIGINT"): void => {
    if (terminalTask !== null) {
      duplicate(signal);
      handoffSignal(host, signal, options.signalAction ?? "reemit");
      return;
    }

    const error = new Error(`Host received ${signal}`);
    terminalTask = deliver(signal, error).then((outcome) => {
      emitOutcome(options, outcome);
      detach();
      handoffSignal(host, signal, options.signalAction ?? "reemit");
    }, (deliveryError) => {
      emitOutcome(options, { signal, outcome: "dropped", reason: "delivery_failed" });
      detach();
      console.warn(`Hexclave analytics: failed to deliver ${signal} lifecycle event:`, deliveryError);
      handoffSignal(host, signal, options.signalAction ?? "reemit");
    });
    track(terminalTask);
  };

  const uncaughtExceptionListener = (...args: unknown[]): void => {
    beginFatal("uncaughtException", args[0]);
  };
  const unhandledRejectionListener = (...args: unknown[]): void => {
    beginFatal("unhandledRejection", args[0]);
  };
  const sigtermListener = (): void => beginSignal("SIGTERM");
  const sigintListener = (): void => beginSignal("SIGINT");

  const install = (event: string, listener: (...args: unknown[]) => void): void => {
    host.on(event, listener);
    listeners.push([event, listener]);
  };

  try {
    install("uncaughtException", uncaughtExceptionListener);
    install("unhandledRejection", unhandledRejectionListener);
    install("SIGTERM", sigtermListener);
    install("SIGINT", sigintListener);
  } catch (error) {
    removeListeners(host, listeners);
    throw error;
  }

  let uninstall: ServerLifecycleUninstall = () => {};
  uninstall = () => {
    detach();
  };

  registry.set(options.ownerKey, uninstall);

  return {
    get active() {
      return active;
    },
    uninstall,
    waitForIdle: async () => {
      await Promise.all([...pending]);
    },
  };
}
