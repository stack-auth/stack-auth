import type { InternalSession } from "@stackframe/stack-shared/dist/sessions";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import { generateUuid } from "./session-replay";

export type ServerBatcherDeps = {
  sendBatch: (body: string, session: InternalSession | null, options: { keepalive: boolean }) => Promise<Result<Response, Error>>,
  waitUntil?: (promise: Promise<any>) => void,
  payloadKey: string,
  maxPerBatch: number,
};

// Use globalThis with Symbol.for so shutdown state is shared even if this module
// is loaded as both CJS and ESM in the same process (dual-package hazard).
const GLOBAL_KEY = Symbol.for("stack-auth:ServerBatcher");
type GlobalBatcherState = { shutdownRegistered: boolean; instances: Set<{ flush(): Promise<void> }> };
const _globalRecord = globalThis as unknown as Record<symbol, GlobalBatcherState | undefined>;

function getGlobalState(): GlobalBatcherState {
  let state = _globalRecord[GLOBAL_KEY];
  if (!state) {
    state = { shutdownRegistered: false, instances: new Set() };
    _globalRecord[GLOBAL_KEY] = state;
  }
  return state;
}

export class ServerBatcher<T> {
  private _items: { item: T; session: InternalSession | null }[] = [];
  private _approxBytes = 0;
  private _flushTimer: ReturnType<typeof setInterval> | null = null;
  private _started = false;
  private _stopped = false;
  private readonly _deps: ServerBatcherDeps;

  constructor(deps: ServerBatcherDeps) {
    this._deps = deps;
  }

  start() {
    if (this._started) return;
    this._started = true;

    this._flushTimer = setInterval(() => this._tick(), 10_000);
    if (typeof this._flushTimer === "object" && "unref" in this._flushTimer) {
      this._flushTimer.unref();
    }

    const global = getGlobalState();
    global.instances.add(this);
    if (!global.shutdownRegistered && typeof process !== "undefined") {
      global.shutdownRegistered = true;
      process.on("beforeExit", () => {
        const promises: Promise<void>[] = [];
        for (const instance of global.instances) {
          promises.push(instance.flush());
        }
        runAsynchronously(() => Promise.all(promises), { noErrorLogging: true });
      });
    }
  }

  async stop(): Promise<void> {
    this._stopped = true;
    if (this._flushTimer !== null) {
      clearInterval(this._flushTimer);
      this._flushTimer = null;
    }
    await this.flush();
    getGlobalState().instances.delete(this);
  }

  push(item: T, session: InternalSession | null) {
    if (this._stopped) return;

    this._items.push({ item, session });
    this._approxBytes += JSON.stringify(item).length;

    if (this._items.length >= this._deps.maxPerBatch || this._approxBytes >= 64_000) {
      const promise = this.flush();
      runAsynchronously(promise, { noErrorLogging: true });
      this._deps.waitUntil?.(promise);
    }
  }

  async flush(): Promise<void> {
    if (this._items.length === 0) return;

    const items = this._items;
    this._items = [];
    this._approxBytes = 0;

    const groups = new Map<string, { session: InternalSession | null, items: T[] }>();
    for (const { item, session } of items) {
      const key = session?.sessionKey ?? "__no_session__";
      let group = groups.get(key);
      if (!group) {
        group = { session, items: [] };
        groups.set(key, group);
      }
      group.items.push(item);
    }

    await Promise.all(
      [...groups.values()].map(async (group) => {
        const res = await this._deps.sendBatch(
          JSON.stringify({
            batch_id: generateUuid(),
            sent_at_ms: Date.now(),
            [this._deps.payloadKey]: group.items,
          }),
          group.session,
          { keepalive: false },
        );

        if (res.status === "error") {
          console.warn(`ServerBatcher(${this._deps.payloadKey}) flush failed:`, res.error);
        } else if (!res.data.ok) {
          console.warn(`ServerBatcher(${this._deps.payloadKey}) flush failed:`, res.data.status, await res.data.text());
        }
      }),
    );
  }

  private _tick() {
    if (this._stopped || this._items.length === 0) return;
    const promise = this.flush();
    runAsynchronously(promise, { noErrorLogging: true });
    this._deps.waitUntil?.(promise);
  }
}
