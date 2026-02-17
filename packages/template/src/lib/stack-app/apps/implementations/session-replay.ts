import { isBrowserLike } from "@stackframe/stack-shared/dist/utils/env";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { Result } from "@stackframe/stack-shared/dist/utils/results";

export type AnalyticsReplayOptions = {
  /**
   * Whether session replays are enabled.
   *
   * @default false
   */
  enabled?: boolean,
  /**
   * Whether to mask the content of all `<input>` elements.
   *
   * @default true
   */
  maskAllInputs?: boolean,
  /**
   * A CSS class name or RegExp. Elements with a matching class will be blocked
   * (replaced with a placeholder in the recording).
   *
   * @default undefined
   */
  blockClass?: string | RegExp,
  /**
   * A CSS selector string. Elements matching this selector will be blocked
   * (replaced with a placeholder in the recording).
   *
   * @default undefined
   */
  blockSelector?: string,
};

export type AnalyticsOptions = {
  /**
   * Options for session replay recording. Replays are disabled by default;
   * set `enabled: true` to opt in.
   */
  replays?: AnalyticsReplayOptions,
};

/**
 * Converts AnalyticsOptions to a JSON-safe representation.
 * RegExp blockClass values are serialized as `{ __regexp, __flags }` objects.
 * The return type is AnalyticsOptions to keep StackClientAppJson simple;
 * the actual runtime value is JSON-safe.
 */
export function analyticsOptionsToJson(options: AnalyticsOptions | undefined): AnalyticsOptions | undefined {
  if (!options?.replays?.blockClass) return options;
  const { blockClass, ...rest } = options.replays;
  if (!(blockClass instanceof RegExp)) return options;
  return {
    replays: {
      ...rest,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      blockClass: { __regexp: blockClass.source, __flags: blockClass.flags } as any,
    },
  };
}

/**
 * Reconstructs AnalyticsOptions from a JSON-deserialized value.
 * Converts `{ __regexp, __flags }` objects back to RegExp instances.
 */
export function analyticsOptionsFromJson(json: AnalyticsOptions | undefined): AnalyticsOptions | undefined {
  if (!json?.replays?.blockClass) return json;
  const { blockClass, ...rest } = json.replays;
  if (typeof blockClass === 'object' && '__regexp' in blockClass) {
    const bc = blockClass as unknown as { __regexp: string, __flags: string };
    return {
      replays: {
        ...rest,
        blockClass: new RegExp(bc.__regexp, bc.__flags),
      },
    };
  }
  return json;
}

// ---------- Recording internals ----------

const LOCAL_STORAGE_PREFIX = "stack:session-replay:v1";
const IDLE_TTL_MS = 3 * 60 * 1000;

const FLUSH_INTERVAL_MS = 5_000;
const MAX_EVENTS_PER_BATCH = 200;
const MAX_APPROX_BYTES_PER_BATCH = 512_000;

const MAX_PREAUTH_BUFFER_EVENTS = 10_000;
const MAX_PREAUTH_BUFFER_BYTES = 5_000_000;

export type StoredSession = {
  session_id: string,
  created_at_ms: number,
  last_activity_ms: number,
};

export function safeParseStoredSession(raw: string | null): StoredSession | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    if (typeof parsed.session_id !== "string") return null;
    if (typeof parsed.created_at_ms !== "number") return null;
    if (typeof parsed.last_activity_ms !== "number") return null;
    return parsed as StoredSession;
  } catch {
    return null;
  }
}

export function makeStorageKey(projectId: string) {
  return `${LOCAL_STORAGE_PREFIX}:${projectId}`;
}

export function generateUuid() {
  return crypto.randomUUID();
}

export function getOrRotateSession(options: { key: string, nowMs: number }): StoredSession {
  const existing = safeParseStoredSession(localStorage.getItem(options.key));
  if (existing && options.nowMs - existing.last_activity_ms <= IDLE_TTL_MS) {
    return existing;
  }
  const next: StoredSession = {
    session_id: generateUuid(),
    created_at_ms: options.nowMs,
    last_activity_ms: options.nowMs,
  };
  localStorage.setItem(options.key, JSON.stringify(next));
  return next;
}

export type SessionRecorderDeps = {
  projectId: string,
  getAccessToken: () => Promise<string | null>,
  sendBatch: (body: string, options: { keepalive: boolean }) => Promise<Result<Response, Error>>,
};

export class SessionRecorder {
  private _started = false;
  private _cancelled = false;
  private _stopRecording: (() => void) | null = null;
  private _detachListeners: (() => void) | null = null;
  private _flushTimer: ReturnType<typeof setInterval> | null = null;
  private _events: unknown[] = [];
  private _approxBytes = 0;
  private _lastPersistActivity = 0;
  private _recording = false;
  private _rrwebModule: typeof import("rrweb") | null = null;
  private _lastKnownAccessToken: string | null = null;
  private _wasAuthenticated = false;
  private readonly _sessionReplaySegmentId: string;
  private readonly _storageKey: string;
  private readonly _deps: SessionRecorderDeps;
  private readonly _replayOptions: AnalyticsReplayOptions;

  constructor(deps: SessionRecorderDeps, replayOptions: AnalyticsReplayOptions) {
    this._deps = deps;
    this._replayOptions = replayOptions;
    this._sessionReplaySegmentId = generateUuid();
    this._storageKey = makeStorageKey(deps.projectId);
  }

  /**
   * Starts recording. Idempotent — calling multiple times is safe.
   */
  start() {
    if (this._started) return;
    if (!isBrowserLike()) return;
    this._started = true;

    // Kick off rrweb recording
    runAsynchronously(() => this._startRecording(), { noErrorLogging: true });

    // Periodic flush + token refresh
    this._flushTimer = setInterval(() => this._tick(), FLUSH_INTERVAL_MS);
  }

  stop() {
    this._cancelled = true;
    if (this._flushTimer !== null) {
      clearInterval(this._flushTimer);
      this._flushTimer = null;
    }
    // Flush remaining events before cleanup
    runAsynchronously(() => this._flush({ keepalive: true }), { noErrorLogging: true });
    this._stopCurrentRecording();
  }

  private _persistActivity(nowMs: number) {
    const stored = getOrRotateSession({ key: this._storageKey, nowMs });
    if (nowMs - this._lastPersistActivity < 5_000) return;
    this._lastPersistActivity = nowMs;
    const updated: StoredSession = { ...stored, last_activity_ms: nowMs };
    localStorage.setItem(this._storageKey, JSON.stringify(updated));
  }

  private async _flush(options: { keepalive: boolean }) {
    if (!this._lastKnownAccessToken) return;
    if (this._events.length === 0) return;

    const nowMs = Date.now();
    const stored = getOrRotateSession({ key: this._storageKey, nowMs });

    const batchId = generateUuid();
    const payload = {
      browser_session_id: stored.session_id,
      session_replay_segment_id: this._sessionReplaySegmentId,
      batch_id: batchId,
      started_at_ms: stored.created_at_ms,
      sent_at_ms: nowMs,
      events: this._events,
    };

    this._events = [];
    this._approxBytes = 0;

    const res = await this._deps.sendBatch(
      JSON.stringify(payload),
      { keepalive: options.keepalive },
    );

    if (res.status === "error") {
      console.warn("SessionRecorder flush failed:", res.error);
      return;
    }

    if (!res.data.ok) {
      console.warn("SessionRecorder flush failed:", res.data.status, await res.data.text());
    }
  }

  private async _startRecording() {
    if (this._recording || this._cancelled) return;

    if (!this._rrwebModule) {
      const rrwebImport = await Result.fromPromise(import("rrweb"));
      if (rrwebImport.status === "error") {
        console.warn("SessionRecorder: rrweb import failed. Is rrweb installed?", rrwebImport.error);
        return;
      }
      this._rrwebModule = rrwebImport.data;
    }

    // cancelled may change during the await above
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (this._cancelled) return;

    this._stopRecording = this._rrwebModule.record({
      emit: (event) => {
        const nowMs = Date.now();
        this._persistActivity(nowMs);

        this._events.push(event);
        this._approxBytes += JSON.stringify(event).length;
        if (this._events.length >= MAX_EVENTS_PER_BATCH || this._approxBytes >= MAX_APPROX_BYTES_PER_BATCH) {
          runAsynchronously(() => this._flush({ keepalive: false }), { noErrorLogging: true });
        }

        // Cap pre-auth buffer to prevent unbounded memory growth
        if (!this._lastKnownAccessToken && (this._events.length > MAX_PREAUTH_BUFFER_EVENTS || this._approxBytes > MAX_PREAUTH_BUFFER_BYTES)) {
          this._events = [];
          this._approxBytes = 0;
        }
      },
      maskAllInputs: this._replayOptions.maskAllInputs ?? true,
      ...(this._replayOptions.blockClass !== undefined ? { blockClass: this._replayOptions.blockClass } : {}),
      ...(this._replayOptions.blockSelector !== undefined ? { blockSelector: this._replayOptions.blockSelector } : {}),
    }) ?? null;

    this._recording = true;

    const onPageHide = () => {
      runAsynchronously(() => this._flush({ keepalive: true }), { noErrorLogging: true });
    };
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onPageHide);
    this._detachListeners = () => {
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onPageHide);
    };
  }

  private _stopCurrentRecording() {
    if (this._detachListeners) {
      this._detachListeners();
      this._detachListeners = null;
    }
    if (this._stopRecording) {
      this._stopRecording();
      this._stopRecording = null;
    }
    this._events = [];
    this._approxBytes = 0;
    this._recording = false;
  }

  private _tick() {
    if (this._cancelled) return;

    // Refresh the cached access token (async, fire-and-forget for this tick)
    runAsynchronously(async () => {
      this._lastKnownAccessToken = await this._deps.getAccessToken();
    }, { noErrorLogging: true });

    const hasAuth = !!this._lastKnownAccessToken;
    // Clear buffer on logout to prevent cross-user event leakage
    if (this._wasAuthenticated && !hasAuth) {
      this._events = [];
      this._approxBytes = 0;
    }
    this._wasAuthenticated = hasAuth;
    if (hasAuth && this._events.length > 0) {
      runAsynchronously(() => this._flush({ keepalive: false }), { noErrorLogging: true });
    }
  }
}
