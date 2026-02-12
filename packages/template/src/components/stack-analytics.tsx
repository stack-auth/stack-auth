"use client";

import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import React, { useEffect, useMemo, useRef } from "react";
import { useStackApp } from "../lib/hooks";
import { stackAppInternalsSymbol } from "../lib/stack-app/common";

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
}

export type AnalyticsOptions = {
  /**
   * Options for session replay recording. Replays are disabled by default;
   * set `enabled: true` to opt in.
   */
  replays?: AnalyticsReplayOptions,
}

const LOCAL_STORAGE_PREFIX = "stack:session-recording:v1";
const IDLE_TTL_MS = 3 * 60 * 1000;

const FLUSH_INTERVAL_MS = 5_000;
const MAX_EVENTS_PER_BATCH = 200;
const MAX_APPROX_BYTES_PER_BATCH = 512_000;

const MAX_PREAUTH_BUFFER_EVENTS = 10_000;
const MAX_PREAUTH_BUFFER_BYTES = 5_000_000;

type StoredSession = {
  session_id: string,
  created_at_ms: number,
  last_activity_ms: number,
};

function isBrowser() {
  return typeof window !== "undefined";
}

function safeParseStoredSession(raw: string | null): StoredSession | null {
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

function makeStorageKey(projectId: string) {
  return `${LOCAL_STORAGE_PREFIX}:${projectId}`;
}

function generateUuid() {
  if (!isBrowser()) {
    throw new Error("generateUuid() called outside browser");
  }
  return crypto.randomUUID();
}

function getOrRotateSession(options: { key: string, nowMs: number }): StoredSession {
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

export function StackAnalyticsInternal(props: { replayOptions?: AnalyticsReplayOptions }) {
  const app = useStackApp();
  const tabId = useMemo(() => isBrowser() ? crypto.randomUUID() : "", []);

  // Use reactive hooks for tokens instead of app.getAccessToken() which
  // calls getUser() -> /users/me on every invocation (bypassing the cache).
  // These hooks subscribe to the cache and only trigger network requests when needed.
  const accessToken = app.useAccessToken();

  // Ref so the effect closure always has the latest token value
  // without needing it in the dependency array (which would restart recording).
  const accessTokenRef = useRef(accessToken);
  accessTokenRef.current = accessToken;

  useEffect(() => {
    let cancelled = false;
    let stopRecording: (() => void) | null = null;
    let detachListeners: (() => void) | null = null;
    let flushTimer: number | null = null;
    let events: unknown[] = [];
    let approxBytes = 0;
    let lastPersistActivity = 0;
    let recording = false;
    let rrwebModule: typeof import("rrweb") | null = null;

    const storageKey = makeStorageKey(app.projectId);

    const persistActivity = (nowMs: number) => {
      const stored = getOrRotateSession({ key: storageKey, nowMs });
      if (nowMs - lastPersistActivity < 5_000) return;
      lastPersistActivity = nowMs;
      const updated: StoredSession = { ...stored, last_activity_ms: nowMs };
      localStorage.setItem(storageKey, JSON.stringify(updated));
    };

    const flush = async (options: { keepalive: boolean }) => {
      if (!accessTokenRef.current) return;
      if (events.length === 0) return;

      const nowMs = Date.now();
      const stored = getOrRotateSession({ key: storageKey, nowMs });

      const batchId = generateUuid();
      const payload = {
        browser_session_id: stored.session_id,
        tab_id: tabId,
        batch_id: batchId,
        started_at_ms: stored.created_at_ms,
        sent_at_ms: nowMs,
        events,
      };

      events = [];
      approxBytes = 0;

      const res = await app[stackAppInternalsSymbol].sendSessionRecordingBatch(
        JSON.stringify(payload),
        { keepalive: options.keepalive },
      );

      if (res.status === "error") {
        // This is best-effort telemetry. Don't throw and break the app.
        console.warn("StackAnalyticsInternal flush failed:", res.error);
        return;
      }

      if (!res.data.ok) {
        console.warn("StackAnalyticsInternal flush failed:", res.data.status, await res.data.text());
      }
    };

    const startRecording = async () => {
      if (recording || cancelled) return;

      if (!rrwebModule) {
        const rrwebImport = await Result.fromPromise(import("rrweb"));
        if (rrwebImport.status === "error") {
          console.warn("StackAnalyticsInternal: rrweb import failed. Is rrweb installed?", rrwebImport.error);
          return;
        }
        rrwebModule = rrwebImport.data;
      }

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- cancelled may change during the await above
      if (cancelled) return;

      stopRecording = rrwebModule.record({
        emit: (event) => {
          const nowMs = Date.now();
          persistActivity(nowMs);

          events.push(event);
          approxBytes += JSON.stringify(event).length;
          if (events.length >= MAX_EVENTS_PER_BATCH || approxBytes >= MAX_APPROX_BYTES_PER_BATCH) {
            runAsynchronously(() => flush({ keepalive: false }), { noErrorLogging: true });
          }

          // Cap pre-auth buffer to prevent unbounded memory growth
          if (!accessTokenRef.current && (events.length > MAX_PREAUTH_BUFFER_EVENTS || approxBytes > MAX_PREAUTH_BUFFER_BYTES)) {
            events = [];
            approxBytes = 0;
          }
        },
        maskAllInputs: props.replayOptions?.maskAllInputs ?? true,
        ...(props.replayOptions?.blockClass !== undefined ? { blockClass: props.replayOptions.blockClass } : {}),
        ...(props.replayOptions?.blockSelector !== undefined ? { blockSelector: props.replayOptions.blockSelector } : {}),
      }) ?? null;

      recording = true;

      const onPageHide = () => {
        runAsynchronously(() => flush({ keepalive: true }), { noErrorLogging: true });
      };
      window.addEventListener("pagehide", onPageHide);
      document.addEventListener("visibilitychange", onPageHide);
      detachListeners = () => {
        window.removeEventListener("pagehide", onPageHide);
        document.removeEventListener("visibilitychange", onPageHide);
      };
    };

    const stopCurrentRecording = () => {
      if (detachListeners) {
        detachListeners();
        detachListeners = null;
      }
      if (stopRecording) {
        stopRecording();
        stopRecording = null;
      }
      events = [];
      approxBytes = 0;
      recording = false;
    };

    // Periodically flushes events.
    let wasAuthenticated = !!accessTokenRef.current;
    const tick = () => {
      if (cancelled) return;
      const hasAuth = !!accessTokenRef.current;
      // Clear buffer on logout to prevent cross-user event leakage
      if (wasAuthenticated && !hasAuth) {
        events = [];
        approxBytes = 0;
      }
      wasAuthenticated = hasAuth;
      if (hasAuth && events.length > 0) {
        runAsynchronously(() => flush({ keepalive: false }), { noErrorLogging: true });
      }
    };

    // Start recording immediately so pre-login activity is captured.
    runAsynchronously(() => startRecording(), { noErrorLogging: true });

    flushTimer = window.setInterval(tick, FLUSH_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (flushTimer !== null) {
        window.clearInterval(flushTimer);
      }
      // Flush remaining events before cleanup
      runAsynchronously(() => flush({ keepalive: true }), { noErrorLogging: true });
      stopCurrentRecording();
    };
  }, [app, tabId]);

  return null;
}
