import type { FlyClient, FlyLogEntry } from "./fly/client.js";
import type { LogLine } from "./types.js";

// Fly's logs API paginates with an opaque next_token that is in fact a nanosecond
// timestamp; a synthesized token (millis * 1e6) pages from that point in time
// (smoke-verified). That's what makes the contract's since_millis cursor stateless.

export function sinceMillisToNextToken(sinceMillis: number): string {
  return String(Math.max(0, Math.floor(sinceMillis)) * 1e6);
}

export function flyEntryToLogLine(entry: FlyLogEntry, options?: { forceNullInstance?: boolean }): LogLine {
  const provider = entry.attributes.meta?.event?.provider;
  const isPlatformEvent = provider !== undefined && provider !== "app";
  return {
    at_millis: Date.parse(entry.attributes.timestamp),
    stream: isPlatformEvent ? "system" : entry.attributes.level === "error" ? "stderr" : "stdout",
    instance: options?.forceNullInstance || isPlatformEvent ? null : entry.attributes.instance,
    text: entry.attributes.message,
  };
}

export type LogPage = { lines: LogLine[], nextSinceMillis: number };

export async function fetchLogPage(fly: FlyClient, app: string, options: { sinceMillis?: number, instance?: string, forceNullInstance?: boolean }): Promise<LogPage> {
  const result = await fly.getLogs(app, {
    nextToken: options.sinceMillis !== undefined ? sinceMillisToNextToken(options.sinceMillis) : undefined,
    instance: options.instance,
  });
  const lines = result.entries.map((entry) => flyEntryToLogLine(entry, { forceNullInstance: options.forceNullInstance }));
  const lastAtMillis = lines.length > 0 ? lines[lines.length - 1].at_millis : undefined;
  return {
    // +1 so re-polling from next_since_millis doesn't replay the last line (millisecond
    // granularity can drop sub-ms siblings; acceptable for log polling).
    nextSinceMillis: lastAtMillis !== undefined ? lastAtMillis + 1 : options.sinceMillis ?? Date.now(),
    lines,
  };
}

// Drain every page of an app's logs from a starting point — used once per build, at
// finalization, to persist the durable build log to the bucket.
export async function fetchAllLogs(fly: FlyClient, app: string, options: { sinceMillis: number, instance?: string }): Promise<LogLine[]> {
  const lines: LogLine[] = [];
  let nextToken: string | undefined = sinceMillisToNextToken(options.sinceMillis);
  // 200 pages × 100 entries bounds this at 20k lines — plenty for a 15-minute build.
  for (let page = 0; page < 200; page++) {
    const result = await fly.getLogs(app, { nextToken, instance: options.instance });
    lines.push(...result.entries.map((entry) => flyEntryToLogLine(entry, { forceNullInstance: true })));
    if (result.nextToken === null || result.entries.length === 0) break;
    nextToken = result.nextToken;
  }
  return lines;
}
