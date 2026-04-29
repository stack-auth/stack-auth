/**
 * Analyze captured spans for a specific endpoint. Reads /tmp/stack-spans.jsonl,
 * keeps only traces whose root span URL matches --path/--method, and prints a
 * self-time breakdown.
 *
 * Usage:
 *   pnpm exec tsx apps/backend/scripts/analyze-endpoint.ts \
 *     --path=/api/v1/auth/otp/sign-in --method=POST
 */

import { readFileSync } from "node:fs";

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

const traceFile = (args.traceFile as string | undefined) ?? "/tmp/stack-spans.jsonl";
const path = (args.path as string | undefined) ?? "/api/v1/auth/otp/sign-in";
const method = ((args.method as string | undefined) ?? "POST").toUpperCase();

function pad(s: string, n: number, right = false) {
  return right ? s.padStart(n) : s.padEnd(n);
}
function fmt(n: number) {
  return n < 10 ? n.toFixed(1) : n.toFixed(0);
}

const raw = readFileSync(traceFile, "utf8");
const spans: Span[] = raw.split("\n").filter(Boolean).map((line) => {
  try { return JSON.parse(line) as Span; } catch { return null; }
}).filter((x): x is Span => x !== null);

const byTrace = new Map<string, Span[]>();
for (const s of spans) {
  if (!byTrace.has(s.traceId)) byTrace.set(s.traceId, []);
  byTrace.get(s.traceId)!.push(s);
}

const matchingTraces: string[] = [];
const wallTimes: number[] = [];
for (const [tid, ss] of byTrace) {
  // Identify a request root span: has http.request.method attribute (Elysia plugin sets this).
  const root = ss.find((s) => {
    const m = (s.attributes["http.request.method"] as string | undefined);
    const p = (s.attributes["url.path"] as string | undefined);
    return m && p && m.toUpperCase() === method && p === path;
  });
  if (root) {
    matchingTraces.push(tid);
    wallTimes.push(root.durationMs);
  }
}

if (matchingTraces.length === 0) {
  console.log(`No traces matched ${method} ${path}. Available endpoints in span file:`);
  const endpoints = new Set<string>();
  for (const ss of byTrace.values()) {
    for (const s of ss) {
      const m = s.attributes["http.request.method"] as string | undefined;
      const p = s.attributes["url.path"] as string | undefined;
      if (m && p) endpoints.add(`${m} ${p}`);
    }
  }
  for (const e of [...endpoints].slice(0, 30)) console.log(` - ${e}`);
  process.exit(0);
}

type Bucket = { totalMs: number, selfMs: number, count: number, samples: number[] };
const buckets = new Map<string, Bucket>();
function upsert(name: string, total: number, self: number) {
  const b = buckets.get(name) ?? { totalMs: 0, selfMs: 0, count: 0, samples: [] };
  b.totalMs += total;
  b.selfMs += self;
  b.count += 1;
  b.samples.push(total);
  buckets.set(name, b);
}

for (const tid of matchingTraces) {
  const ss = byTrace.get(tid)!;
  const childrenByParent = new Map<string, Span[]>();
  for (const s of ss) {
    const p = s.parentSpanId ?? "";
    if (!childrenByParent.has(p)) childrenByParent.set(p, []);
    childrenByParent.get(p)!.push(s);
  }
  for (const s of ss) {
    const children = childrenByParent.get(s.spanId) ?? [];
    const childSum = children.reduce((acc, c) => acc + c.durationMs, 0);
    upsert(s.name, s.durationMs, Math.max(0, s.durationMs - childSum));
  }
}

wallTimes.sort((a, b) => a - b);
const p = (q: number) => wallTimes[Math.min(wallTimes.length - 1, Math.floor(q * wallTimes.length))];
const avg = wallTimes.reduce((a, b) => a + b, 0) / wallTimes.length;
console.log(`\n${method} ${path}  —  ${wallTimes.length} traces`);
console.log(`request total: avg=${fmt(avg)}ms  p50=${fmt(p(0.5))}ms  p95=${fmt(p(0.95))}ms  p99=${fmt(p(0.99))}ms  max=${fmt(wallTimes[wallTimes.length - 1])}ms\n`);

const ranked = [...buckets.entries()]
  .map(([name, b]) => ({ name, ...b, avgTotal: b.totalMs / b.count, avgSelf: b.selfMs / b.count }))
  .sort((a, b) => b.selfMs - a.selfMs);
const totalSelf = ranked.reduce((a, r) => a + r.selfMs, 0) || 1;

console.log(`${pad("span", 56)}${pad("count", 7, true)}${pad("avg total", 11, true)}${pad("avg self", 11, true)}${pad("self %", 9, true)}`);
for (const r of ranked.slice(0, 30)) {
  console.log(`${pad(r.name.slice(0, 56), 56)}${pad(String(r.count), 7, true)}${pad(fmt(r.avgTotal) + "ms", 11, true)}${pad(fmt(r.avgSelf) + "ms", 11, true)}${pad(((r.selfMs / totalSelf) * 100).toFixed(1) + "%", 9, true)}`);
}
