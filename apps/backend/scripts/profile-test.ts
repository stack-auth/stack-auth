/**
 * Run a single vitest test and profile the spans it produced.
 *
 * Assumes the dev server is running with STACK_TRACE_LOG_FILE=/tmp/stack-spans.jsonl
 * and that the test hits that backend. We truncate the span log before running,
 * then parse what was emitted.
 *
 * Usage:
 *   pnpm exec tsx apps/backend/scripts/profile-test.ts \
 *     --file=apps/e2e/tests/backend/endpoints/api/v1/users.test.ts \
 *     --name="should be able to update own user"
 */

import { spawn } from "node:child_process";
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

const file = args.file as string | undefined;
const name = args.name as string | undefined;
const traceFile = (args.traceFile as string | undefined) ?? "/tmp/stack-spans.jsonl";
if (!file || !name) {
  console.error("Required: --file=<test file> --name=<test name>");
  process.exit(1);
}

function pad(s: string, n: number, right = false) {
  return right ? s.padStart(n) : s.padEnd(n);
}
function fmt(n: number) {
  return n < 10 ? n.toFixed(1) : n.toFixed(0);
}

(async () => {
  try { truncateSync(traceFile); } catch { writeFileSync(traceFile, ""); }

  const startWall = performance.now();
  const cmd = "pnpm";
  const argv = ["exec", "vitest", "run", file, "-t", name, "--pool=forks", "--minWorkers=1", "--maxWorkers=1", "--reporter=verbose"];
  console.log(`Running: ${cmd} ${argv.join(" ")}`);

  let stdout = "";
  let stderr = "";
  const child = spawn(cmd, argv, { cwd: "/Users/bgodil/source/stack-auth/apps/e2e" });
  child.stdout.on("data", (d) => { stdout += d.toString(); process.stdout.write(d); });
  child.stderr.on("data", (d) => { stderr += d.toString(); process.stderr.write(d); });
  await new Promise((r) => child.on("close", r));
  const wallMs = performance.now() - startWall;

  // Allow exporter to flush.
  await new Promise((r) => setTimeout(r, 500));

  const raw = readFileSync(traceFile, "utf8");
  const spans: Span[] = raw.split("\n").filter(Boolean).map((line) => {
    try { return JSON.parse(line) as Span; } catch { return null; }
  }).filter((x): x is Span => x !== null);

  const byTrace = new Map<string, Span[]>();
  for (const s of spans) {
    if (!byTrace.has(s.traceId)) byTrace.set(s.traceId, []);
    byTrace.get(s.traceId)!.push(s);
  }

  type Bucket = { totalMs: number, selfMs: number, count: number };
  const buckets = new Map<string, Bucket>();
  function upsert(name: string, total: number, self: number) {
    const b = buckets.get(name) ?? { totalMs: 0, selfMs: 0, count: 0 };
    b.totalMs += total;
    b.selfMs += self;
    b.count += 1;
    buckets.set(name, b);
  }

  // Per-request bucket (group by url path of root span).
  type Endpoint = { path: string, count: number, totalMs: number };
  const endpoints = new Map<string, Endpoint>();

  for (const [, traceSpans] of byTrace) {
    const childrenByParent = new Map<string, Span[]>();
    for (const s of traceSpans) {
      const p = s.parentSpanId ?? "";
      if (!childrenByParent.has(p)) childrenByParent.set(p, []);
      childrenByParent.get(p)!.push(s);
    }

    let rootDuration = 0;
    let rootPath: string | undefined;
    for (const s of traceSpans) {
      const children = childrenByParent.get(s.spanId) ?? [];
      const childSum = children.reduce((acc, c) => acc + c.durationMs, 0);
      upsert(s.name, s.durationMs, Math.max(0, s.durationMs - childSum));
      const parent = s.parentSpanId;
      if (!parent || !traceSpans.find((p) => p.spanId === parent)) {
        if (s.durationMs > rootDuration) {
          rootDuration = s.durationMs;
          const url = (s.attributes["url.path"] || s.attributes["http.target"] || s.attributes["stack.request.url"]) as string | undefined;
          if (typeof url === "string") rootPath = url.replace(/\?.*/, "");
        }
      }
    }
    if (rootPath) {
      const e = endpoints.get(rootPath) ?? { path: rootPath, count: 0, totalMs: 0 };
      e.count += 1;
      e.totalMs += rootDuration;
      endpoints.set(rootPath, e);
    }
  }

  console.log(`\nTest wall-clock (incl. vitest startup): ${fmt(wallMs)}ms`);

  const totalServerMs = [...endpoints.values()].reduce((a, e) => a + e.totalMs, 0);
  console.log(`Server-side total (sum of request root spans): ${fmt(totalServerMs)}ms across ${[...endpoints.values()].reduce((a, e) => a + e.count, 0)} requests / ${endpoints.size} distinct endpoints\n`);

  const sortedEndpoints = [...endpoints.values()].sort((a, b) => b.totalMs - a.totalMs);
  console.log(`${pad("endpoint", 70)}${pad("count", 7, true)}${pad("total", 10, true)}${pad("avg", 10, true)}`);
  for (const e of sortedEndpoints) {
    console.log(`${pad(e.path.slice(0, 70), 70)}${pad(String(e.count), 7, true)}${pad(fmt(e.totalMs) + "ms", 10, true)}${pad(fmt(e.totalMs / e.count) + "ms", 10, true)}`);
  }

  console.log(`\nTop spans by self-time (across all requests):`);
  const ranked = [...buckets.entries()]
    .map(([name, b]) => ({ name, ...b }))
    .sort((a, b) => b.selfMs - a.selfMs);
  const totalSelf = ranked.reduce((a, r) => a + r.selfMs, 0) || 1;

  console.log(`${pad("span", 56)}${pad("count", 7, true)}${pad("self", 10, true)}${pad("total", 10, true)}${pad("self %", 9, true)}`);
  for (const r of ranked.slice(0, 25)) {
    console.log(`${pad(r.name.slice(0, 56), 56)}${pad(String(r.count), 7, true)}${pad(fmt(r.selfMs) + "ms", 10, true)}${pad(fmt(r.totalMs) + "ms", 10, true)}${pad(((r.selfMs / totalSelf) * 100).toFixed(1) + "%", 9, true)}`);
  }
})();
