/**
 * Profile a single endpoint by parsing OpenTelemetry spans written to a JSONL file.
 *
 * Usage:
 *   1. Restart the dev server with STACK_TRACE_LOG_FILE=/tmp/stack-spans.jsonl set
 *      (and /tmp/stack-spans.jsonl truncated to empty).
 *   2. Run this script — it sends warmup requests, truncates the file, then sends
 *      a batch of requests, and prints a breakdown of average self/total time per span name.
 */

import { readFileSync, statSync, truncateSync, writeFileSync } from "node:fs";

type Span = {
  name: string,
  traceId: string,
  spanId: string,
  parentSpanId?: string,
  startMs: number,
  durationMs: number,
  attributes: Record<string, unknown>,
};

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  }),
);

const baseUrl = (args.url as string | undefined) ?? "http://localhost:8102";
const path = (args.path as string | undefined) ?? "/api/v1/users";
const method = ((args.method as string | undefined) ?? "GET").toUpperCase();
const iterations = Number.parseInt((args.iterations as string | undefined) ?? "20", 10);
const warmup = Number.parseInt((args.warmup as string | undefined) ?? "5", 10);
const traceFile = (args.traceFile as string | undefined) ?? "/tmp/stack-spans.jsonl";

const headers: Record<string, string> = {
  "x-stack-access-type": "server",
  "x-stack-project-id": "internal",
  "x-stack-publishable-client-key": "this-publishable-client-key-is-for-local-development-only",
  "x-stack-secret-server-key": "this-secret-server-key-is-for-local-development-only",
};

async function hit() {
  const start = performance.now();
  const res = await fetch(`${baseUrl}${path}`, { method, headers });
  await res.arrayBuffer();
  return { status: res.status, ms: performance.now() - start };
}

function readSpans(file: string): Span[] {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  return raw.split("\n").filter(Boolean).map((line) => {
    try { return JSON.parse(line) as Span; } catch { return null; }
  }).filter((x): x is Span => x !== null);
}

function pad(s: string, n: number, right = false) {
  return right ? s.padStart(n) : s.padEnd(n);
}
function fmt(n: number) {
  return n < 10 ? n.toFixed(1) : n.toFixed(0);
}

(async () => {
  // Warmup
  for (let i = 0; i < warmup; i++) await hit();

  // Wait for any in-flight span exports, then truncate.
  await new Promise((r) => setTimeout(r, 200));
  try { truncateSync(traceFile); } catch { writeFileSync(traceFile, ""); }

  const wallSamples: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const { status, ms } = await hit();
    wallSamples.push(ms);
    if (i === 0) console.log(`status=${status}`);
  }

  // Allow exporter to flush.
  await new Promise((r) => setTimeout(r, 500));
  const spans = readSpans(traceFile);

  // Group spans by traceId and find the root request span; ignore traces that aren't ours.
  const byTrace = new Map<string, Span[]>();
  for (const s of spans) {
    if (!byTrace.has(s.traceId)) byTrace.set(s.traceId, []);
    byTrace.get(s.traceId)!.push(s);
  }

  type Bucket = {
    totalMs: number,
    selfMs: number,
    count: number,
    samples: number[],
  };
  const buckets = new Map<string, Bucket>();
  function upsert(name: string, total: number, self: number) {
    const b = buckets.get(name) ?? { totalMs: 0, selfMs: 0, count: 0, samples: [] };
    b.totalMs += total;
    b.selfMs += self;
    b.count += 1;
    b.samples.push(total);
    buckets.set(name, b);
  }

  let validTraces = 0;
  for (const [, traceSpans] of byTrace) {
    // Only count traces that include our request method+path (avoids cron, etc.).
    const interesting = traceSpans.some((s) => {
      const url = (s.attributes["url.path"] || s.attributes["http.target"] || s.attributes["stack.request.url"]) as string | undefined;
      return typeof url === "string" && url.includes(path);
    });
    if (!interesting) continue;
    validTraces++;

    const childrenByParent = new Map<string, Span[]>();
    for (const s of traceSpans) {
      const p = s.parentSpanId ?? "";
      if (!childrenByParent.has(p)) childrenByParent.set(p, []);
      childrenByParent.get(p)!.push(s);
    }
    for (const s of traceSpans) {
      const children = childrenByParent.get(s.spanId) ?? [];
      const childSum = children.reduce((acc, c) => acc + c.durationMs, 0);
      upsert(s.name, s.durationMs, Math.max(0, s.durationMs - childSum));
    }
  }

  wallSamples.sort((a, b) => a - b);
  const p = (q: number) => wallSamples[Math.min(wallSamples.length - 1, Math.floor(q * wallSamples.length))];
  const wallAvg = wallSamples.reduce((a, b) => a + b, 0) / wallSamples.length;
  console.log(`\nWall-clock per request — n=${wallSamples.length}  avg=${fmt(wallAvg)}ms  p50=${fmt(p(0.5))}ms  p95=${fmt(p(0.95))}ms  p99=${fmt(p(0.99))}ms`);
  console.log(`Captured ${spans.length} spans across ${byTrace.size} traces (${validTraces} matching ${path}).\n`);

  if (validTraces === 0) {
    console.log("No matching traces. Was STACK_TRACE_LOG_FILE set on the server, and is the path correct?");
    return;
  }

  const ranked = [...buckets.entries()]
    .map(([name, b]) => ({ name, ...b, avgTotal: b.totalMs / b.count, avgSelf: b.selfMs / b.count }))
    .sort((a, b) => b.selfMs - a.selfMs);

  console.log(`${pad("span", 56)}${pad("count", 7, true)}${pad("avg total", 11, true)}${pad("avg self", 11, true)}${pad("self %", 9, true)}`);
  const totalSelf = ranked.reduce((a, r) => a + r.selfMs, 0) || 1;
  for (const r of ranked.slice(0, 30)) {
    console.log(`${pad(r.name.slice(0, 56), 56)}${pad(String(r.count), 7, true)}${pad(fmt(r.avgTotal) + "ms", 11, true)}${pad(fmt(r.avgSelf) + "ms", 11, true)}${pad(((r.selfMs / totalSelf) * 100).toFixed(1) + "%", 9, true)}`);
  }
})();
