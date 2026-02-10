"use client";

import { Result } from "@stackframe/stack-shared/dist/utils/results";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import React, { useEffect, useMemo } from "react";
import { useStackApp } from "../lib/hooks";
import { stackAppInternalsSymbol } from "../lib/stack-app/common";
import { clientVersion, getBaseUrl, getDefaultExtraRequestHeaders, getDefaultPublishableClientKey } from "../lib/stack-app/apps/implementations/common";

const LOCAL_STORAGE_PREFIX = "stack:session-recording:v1";
const IDLE_TTL_MS = 30 * 60 * 1000;

const FLUSH_INTERVAL_MS = 5_000;
const MAX_EVENTS_PER_BATCH = 200;
const MAX_APPROX_BYTES_PER_BATCH = 512_000;

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

export function StackAnalyticsInternal() {
  const app = useStackApp();
  const tabId = useMemo(() => generateUuid(), []);

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
      const accessToken = await app.getAccessToken();
      const refreshToken = await app.getRefreshToken();
      if (!accessToken) return;
      if (events.length === 0) return;

      const nowMs = Date.now();
      const stored = getOrRotateSession({ key: storageKey, nowMs });

      const batchId = generateUuid();
      const payload = {
        session_id: stored.session_id,
        tab_id: tabId,
        batch_id: batchId,
        started_at_ms: stored.created_at_ms,
        sent_at_ms: nowMs,
        events,
      };

      events = [];
      approxBytes = 0;

      const constructorOptions = app[stackAppInternalsSymbol].getConstructorOptions();
      const baseUrl = getBaseUrl(constructorOptions.baseUrl);
      const publishableClientKey = constructorOptions.publishableClientKey ?? getDefaultPublishableClientKey();
      const extraRequestHeaders = constructorOptions.extraRequestHeaders ?? getDefaultExtraRequestHeaders();

      const res = await Result.fromThrowingAsync(async () => {
        return await fetch(new URL("/api/v1/session-recordings/batch", baseUrl), {
          method: "POST",
          credentials: "omit",
          keepalive: options.keepalive,
          headers: {
            "content-type": "application/json",
            "x-stack-project-id": app.projectId,
            "x-stack-access-type": "client",
            "x-stack-client-version": clientVersion,
            "x-stack-access-token": accessToken,
            ...(refreshToken ? { "x-stack-refresh-token": refreshToken } : {}),
            "x-stack-publishable-client-key": publishableClientKey,
            "x-stack-allow-anonymous-user": "true",
            ...extraRequestHeaders,
          },
          body: JSON.stringify(payload),
        });
      });

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
        },
        maskAllInputs: true,
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

    // Runs every FLUSH_INTERVAL_MS: checks auth state and flushes events.
    // Starts recording when a user is authenticated, stops when they log out.
    const tick = async () => {
      if (cancelled) return;
      const accessToken = await app.getAccessToken();

      if (accessToken && !recording) {
        await startRecording();
      } else if (!accessToken && recording) {
        stopCurrentRecording();
      }

      if (accessToken && events.length > 0) {
        await flush({ keepalive: false });
      }
    };

    runAsynchronously(() => tick(), { noErrorLogging: true });

    flushTimer = window.setInterval(() => {
      runAsynchronously(() => tick(), { noErrorLogging: true });
    }, FLUSH_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (flushTimer !== null) {
        window.clearInterval(flushTimer);
      }
      stopCurrentRecording();
    };
  }, [app, tabId]);

  return null;
}
