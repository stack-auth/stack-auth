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
// Use globalThis to persist across hot reloads
const requestStatsMap: Map<string, RequestStat> = (globalThis as any).__devRequestStatsMap ??= new Map<string, RequestStat>();

function getKey(method: string, path: string): string {
  return `${method}:${path}`;
}

/**
 * Record stats for a completed request.
 * Only records in development mode.
 */
export function recordRequestStats(method: string, path: string, durationMs: number): void {
  if (getNodeEnvironment() !== "development") {
    return;
  }

  const key = getKey(method, path);

  const existing = requestStatsMap.get(key);
  if (existing) {
    existing.count++;
    existing.totalTimeMs += durationMs;
    existing.minTimeMs = Math.min(existing.minTimeMs, durationMs);
    existing.maxTimeMs = Math.max(existing.maxTimeMs, durationMs);
    existing.lastCalledAt = Date.now();
  } else {
    requestStatsMap.set(key, {
      method,
      path,
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

