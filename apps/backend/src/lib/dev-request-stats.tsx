import { getNodeEnvironment } from "@stackframe/stack-shared/dist/utils/env";

export type RequestStat = {
  method: string,
  path: string,
  count: number,
  totalTimeMs: number,
  minTimeMs: number,
  maxTimeMs: number,
  lastCalledAt: number,
};

// In-memory storage for request stats (only used in development)
const requestStatsMap = (globalThis as any).requestStatsMap ??= new Map<string, RequestStat>();

// Ongoing requests that haven't finished yet
const ongoingRequests = (globalThis as any).ongoingRequests ??= new Map<string, { startTime: number, method: string, path: string }>();

let requestIdCounter = 0;

function getKey(method: string, path: string): string {
  return `${method}:${path}`;
}

/**
 * Call this at the start of a request. Returns a unique ID that should be passed to `endRequest`.
 */
export function startRequest(method: string, path: string): string | null {
  if (getNodeEnvironment() !== "development") {
    return null;
  }

  const requestId = `req-${++requestIdCounter}`;
  ongoingRequests.set(requestId, {
    startTime: performance.now(),
    method,
    path,
  });

  return requestId;
}

/**
 * Call this at the end of a request with the ID from `startRequest`.
 */
export function endRequest(requestId: string | null): void {
  if (requestId === null || getNodeEnvironment() !== "development") {
    return;
  }

  const ongoing = ongoingRequests.get(requestId);
  if (!ongoing) {
    return;
  }

  ongoingRequests.delete(requestId);

  const durationMs = performance.now() - ongoing.startTime;
  const key = getKey(ongoing.method, ongoing.path);

  const existing = requestStatsMap.get(key);
  if (existing) {
    existing.count++;
    existing.totalTimeMs += durationMs;
    existing.minTimeMs = Math.min(existing.minTimeMs, durationMs);
    existing.maxTimeMs = Math.max(existing.maxTimeMs, durationMs);
    existing.lastCalledAt = Date.now();
  } else {
    requestStatsMap.set(key, {
      method: ongoing.method,
      path: ongoing.path,
      count: 1,
      totalTimeMs: durationMs,
      minTimeMs: durationMs,
      maxTimeMs: durationMs,
      lastCalledAt: Date.now(),
    });
  }
}

/**
 * Get all request stats
 */
export function getAllRequestStats(): RequestStat[] {
  return Array.from(requestStatsMap.values());
}

/**
 * Get the most common requests by count
 */
export function getMostCommonRequests(limit: number = 20): RequestStat[] {
  return getAllRequestStats()
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/**
 * Get requests sorted by total time spent (most time first)
 */
export function getMostTimeConsumingRequests(limit: number = 20): RequestStat[] {
  return getAllRequestStats()
    .sort((a, b) => b.totalTimeMs - a.totalTimeMs)
    .slice(0, limit);
}

/**
 * Get requests sorted by average time (slowest first)
 */
export function getSlowestRequests(limit: number = 20): RequestStat[] {
  return getAllRequestStats()
    .sort((a, b) => (b.totalTimeMs / b.count) - (a.totalTimeMs / a.count))
    .slice(0, limit);
}

/**
 * Get aggregate stats
 */
export function getAggregateStats() {
  const stats = getAllRequestStats();
  const totalRequests = stats.reduce((sum, s) => sum + s.count, 0);
  const totalTimeMs = stats.reduce((sum, s) => sum + s.totalTimeMs, 0);
  const uniqueEndpoints = stats.length;

  return {
    totalRequests,
    totalTimeMs,
    uniqueEndpoints,
    averageTimeMs: totalRequests > 0 ? totalTimeMs / totalRequests : 0,
  };
}

/**
 * Clear all stats
 */
export function clearRequestStats(): void {
  requestStatsMap.clear();
}

