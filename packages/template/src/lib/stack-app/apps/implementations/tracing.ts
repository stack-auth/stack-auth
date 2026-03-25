import type { AnalyticsBatchSpan } from "@stackframe/stack-shared/dist/interface/crud/analytics";
import { generateUuid } from "./session-replay";
import { parseStackFrames } from "./parse-stack-frames";

export type SpanStatus = "ok" | "error" | "unset";

export type Span = {
  readonly spanId: string;
  readonly traceId: string;
  readonly isEnded: boolean;
  setAttribute(key: string, value: unknown): void;
  setAttributes(attrs: Record<string, unknown>): void;
  setStatus(status: SpanStatus, message?: string): void;
  recordException(error: unknown): void;
  end(): void;
}

export type StartSpanOptions = {
  attributes?: Record<string, unknown>;
  parent?: Span;
  parentSpanId?: string;
  traceId?: string;
  startTime?: Date | number;
};

export function getErrorMetadata(errorLike: unknown): Record<string, unknown> {
  if (errorLike instanceof Error) {
    return {
      error_name: errorLike.name,
      error_message: errorLike.message,
      error_kind: "Error",
      stack: errorLike.stack ?? null,
      stack_frames: errorLike.stack ? parseStackFrames(errorLike.stack) : [],
    };
  }

  if (typeof errorLike === "string") {
    return {
      error_name: null,
      error_message: errorLike,
      error_kind: "string",
      stack: null,
      stack_frames: [],
    };
  }

  if (errorLike == null) {
    return {
      error_name: null,
      error_message: null,
      error_kind: String(errorLike),
      stack: null,
      stack_frames: [],
    };
  }

  if (typeof errorLike === "object") {
    const stack = "stack" in errorLike && typeof errorLike.stack === "string" ? errorLike.stack : null;
    return {
      error_name: "name" in errorLike && typeof errorLike.name === "string" ? errorLike.name : null,
      error_message: "message" in errorLike && typeof errorLike.message === "string" ? errorLike.message : null,
      error_kind: "constructor" in errorLike
        && typeof errorLike.constructor === "function"
        && typeof errorLike.constructor.name === "string"
        ? errorLike.constructor.name
        : "object",
      stack,
      stack_frames: stack ? parseStackFrames(stack) : [],
    };
  }

  return {
    error_name: null,
    error_message: null,
    error_kind: typeof errorLike,
    stack: null,
    stack_frames: [],
  };
}

export type SpanImplOptions = {
  spanType: string;
  spanId?: string;
  traceId?: string;
  parentIds?: string[];
  data?: Record<string, unknown>;
  startedAtMs?: number;
  sessionReplayId?: string | null;
  sessionReplaySegmentId?: string | null;
  onEnd: (span: SpanImpl) => void;
};

export class SpanImpl implements Span {
  readonly spanId: string;
  readonly traceId: string;
  private _spanType: string;
  private _startedAtMs: number;
  private _endedAtMs: number | null = null;
  private _parentIds: string[];
  private _data = new Map<string, unknown>();
  private _status: SpanStatus = "unset";
  private _statusMessage: string | undefined;
  private _sessionReplayId: string | null;
  private _sessionReplaySegmentId: string | null;
  private readonly _onEnd: (span: SpanImpl) => void;

  constructor(options: SpanImplOptions) {
    this.spanId = options.spanId ?? generateUuid();
    this.traceId = options.traceId ?? generateUuid();
    this._spanType = options.spanType;
    this._startedAtMs = options.startedAtMs ?? Date.now();
    this._parentIds = options.parentIds ?? [];
    if (options.data) {
      for (const [k, v] of Object.entries(options.data)) {
        this._data.set(k, v);
      }
    }
    this._sessionReplayId = options.sessionReplayId ?? null;
    this._sessionReplaySegmentId = options.sessionReplaySegmentId ?? null;
    this._onEnd = options.onEnd;
  }

  setAttribute(key: string, value: unknown): void {
    if (this._endedAtMs != null) return;
    this._data.set(key, value);
  }

  setAttributes(attrs: Record<string, unknown>): void {
    if (this._endedAtMs != null) return;
    for (const [key, value] of Object.entries(attrs)) {
      this._data.set(key, value);
    }
  }

  setStatus(status: SpanStatus, message?: string): void {
    if (this._endedAtMs != null) return;
    this._status = status;
    this._statusMessage = message;
  }

  recordException(error: unknown): void {
    this.setStatus("error");
    this.setAttributes(getErrorMetadata(error));
  }

  end(): void {
    if (this._endedAtMs != null) return;
    this._endedAtMs = Date.now();
    if (this._status !== "unset") {
      this._data.set("$status", this._status);
      if (this._statusMessage) {
        this._data.set("$status_message", this._statusMessage);
      }
    }
    this._onEnd(this);
  }

  get isEnded(): boolean {
    return this._endedAtMs != null;
  }

  /** @internal */
  toPayload(): AnalyticsBatchSpan {
    return {
      span_type: this._spanType,
      span_id: this.spanId,
      trace_id: this.traceId,
      started_at_ms: this._startedAtMs,
      ended_at_ms: this._endedAtMs,
      parent_ids: this._parentIds.length > 0 ? this._parentIds : undefined,
      data: Object.fromEntries(this._data),
      session_replay_id: this._sessionReplayId ?? undefined,
      session_replay_segment_id: this._sessionReplaySegmentId ?? undefined,
    };
  }
}

export const noopSpan: Span = {
  spanId: "00000000-0000-0000-0000-000000000000",
  traceId: "00000000-0000-0000-0000-000000000000",
  isEnded: true,
  setAttribute() {},
  setAttributes() {},
  setStatus() {},
  recordException() {},
  end() {},
};

// Span context — AsyncLocalStorage (Node/Deno/Bun/Workers) with sync fallback (browser)

type AsyncLocalStorageLike<T> = {
  getStore(): T | undefined;
  run<R>(store: T, fn: () => R): R;
};

let _spanStorage: AsyncLocalStorageLike<SpanImpl> | null = null;
let _spanStorageInitialized = false;
let _syncActiveSpan: SpanImpl | null = null;

const _syncFallbackStorage: AsyncLocalStorageLike<SpanImpl> = {
  getStore: () => _syncActiveSpan ?? undefined,
  run<R>(store: SpanImpl, fn: () => R): R {
    const prev = _syncActiveSpan;
    _syncActiveSpan = store;
    try {
      return fn();
    } finally {
      _syncActiveSpan = prev;
    }
  },
};

function getSpanStorage(): AsyncLocalStorageLike<SpanImpl> {
  if (_spanStorage) return _spanStorage;
  if (_spanStorageInitialized) {
    _spanStorage = _syncFallbackStorage;
    return _spanStorage;
  }
  _spanStorageInitialized = true;

  try {
    const ALS = (globalThis as any).AsyncLocalStorage;
    if (typeof ALS === "function") {
      _spanStorage = new ALS() as AsyncLocalStorageLike<SpanImpl>;
      return _spanStorage;
    }
  } catch {
    // Not available
  }

  _spanStorage = _syncFallbackStorage;
  return _spanStorage;
}

export function getActiveSpan(): SpanImpl | null {
  return getSpanStorage().getStore() ?? null;
}

export function runWithSpan<T>(span: SpanImpl, fn: () => T): T {
  return getSpanStorage().run(span, fn);
}

// Header utilities — shared between trace context and replay link extraction

export function readHeader(headers: unknown, name: string): string | null {
  if (headers == null || typeof headers !== "object") return null;
  if (typeof (headers as any).get === "function") {
    return (headers as any).get(name) as string | null;
  }
  const val = (headers as Record<string, unknown>)[name];
  if (typeof val === "string") return val;
  if (Array.isArray(val)) return val[0] ?? null;
  return null;
}

function readJsonHeader<T extends Record<string, string | null>>(
  headers: unknown,
  name: string,
  fields: (keyof T & string)[],
): T {
  const result = Object.fromEntries(fields.map((f) => [f, null])) as T;
  const raw = readHeader(headers, name);
  if (!raw) return result;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const field of fields) {
      if (typeof parsed[field] === "string") {
        (result as any)[field] = parsed[field];
      }
    }
  } catch {
    // malformed header
  }
  return result;
}

export function serializeTraceContext(span: { traceId: string; spanId: string }): Record<string, string> {
  return {
    "x-stack-trace": JSON.stringify({ trace_id: span.traceId, span_id: span.spanId }),
  };
}

export function extractTraceContext(headers: unknown) {
  const { trace_id, span_id } = readJsonHeader(headers, "x-stack-trace", ["trace_id", "span_id"]);
  return { traceId: trace_id, parentSpanId: span_id };
}

export function extractReplayLink(headers: unknown) {
  const { session_replay_id, session_replay_segment_id } = readJsonHeader(headers, "x-stack-replay", ["session_replay_id", "session_replay_segment_id"]);
  return { sessionReplayId: session_replay_id, sessionReplaySegmentId: session_replay_segment_id };
}
