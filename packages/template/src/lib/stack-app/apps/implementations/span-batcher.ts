import type { AnalyticsBatchSpan } from "@stackframe/stack-shared/dist/interface/crud/analytics";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import { generateUuid } from "./session-replay";

export type ClientSpanBatcherDeps = {
  sendBatch: (body: string, options: { keepalive: boolean }) => Promise<Result<Response, Error>>,
};

export class ClientSpanBatcher {
  private _spans: AnalyticsBatchSpan[] = [];
  private _approxBytes = 0;
  private _flushTimer: ReturnType<typeof setInterval> | null = null;
  private _started = false;
  private _stopped = false;
  private readonly _deps: ClientSpanBatcherDeps;

  constructor(deps: ClientSpanBatcherDeps) {
    this._deps = deps;
  }

  start() {
    if (this._started) return;
    this._started = true;
    this._flushTimer = setInterval(() => this._tick(), 10_000);

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this._onVisibilityChange);
      window.addEventListener("pagehide", this._onPageHide);
    }
  }

  stop() {
    this._stopped = true;
    if (this._flushTimer !== null) {
      clearInterval(this._flushTimer);
      this._flushTimer = null;
    }

    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this._onVisibilityChange);
      window.removeEventListener("pagehide", this._onPageHide);
    }

    runAsynchronously(() => this._flush({ keepalive: true }), { noErrorLogging: true });
  }

  push(span: AnalyticsBatchSpan) {
    if (this._stopped) return;

    this._spans.push(span);
    this._approxBytes += JSON.stringify(span).length;

    if (this._spans.length >= 200 || this._approxBytes >= 64_000) {
      runAsynchronously(() => this._flush({ keepalive: false }), { noErrorLogging: true });
    }
  }

  async flush(): Promise<void> {
    await this._flush({ keepalive: false });
  }

  private async _flush(options: { keepalive: boolean }): Promise<void> {
    if (this._spans.length === 0) return;

    const spans = this._spans;
    this._spans = [];
    this._approxBytes = 0;

    const res = await this._deps.sendBatch(
      JSON.stringify({
        batch_id: generateUuid(),
        sent_at_ms: Date.now(),
        spans,
      }),
      { keepalive: options.keepalive },
    );

    if (res.status === "error") {
      console.warn("ClientSpanBatcher flush failed:", res.error);
    } else if (!res.data.ok) {
      console.warn("ClientSpanBatcher flush failed:", res.data.status, await res.data.text());
    }
  }

  private _tick() {
    if (this._stopped || this._spans.length === 0) return;
    runAsynchronously(() => this._flush({ keepalive: false }), { noErrorLogging: true });
  }

  private readonly _onVisibilityChange = () => {
    if (document.visibilityState === "hidden") {
      runAsynchronously(() => this._flush({ keepalive: true }), { noErrorLogging: true });
    }
  };

  private readonly _onPageHide = () => {
    runAsynchronously(() => this._flush({ keepalive: true }), { noErrorLogging: true });
  };
}
