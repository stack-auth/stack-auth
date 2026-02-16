export const LOCAL_STORAGE_PREFIX = "stack:session-recording:v1";
export const IDLE_TTL_MS = 3 * 60 * 1000;

export const FLUSH_INTERVAL_MS = 5_000;
export const MAX_EVENTS_PER_BATCH = 200;
export const MAX_APPROX_BYTES_PER_BATCH = 512_000;

export const MAX_PREAUTH_BUFFER_EVENTS = 10_000;
export const MAX_PREAUTH_BUFFER_BYTES = 5_000_000;

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

export function generateSessionUuid() {
  return crypto.randomUUID();
}

export function getOrRotateSession(options: { key: string, nowMs: number }): StoredSession {
  const existing = safeParseStoredSession(localStorage.getItem(options.key));
  if (existing && options.nowMs - existing.last_activity_ms <= IDLE_TTL_MS) {
    return existing;
  }
  const next: StoredSession = {
    session_id: generateSessionUuid(),
    created_at_ms: options.nowMs,
    last_activity_ms: options.nowMs,
  };
  localStorage.setItem(options.key, JSON.stringify(next));
  return next;
}
