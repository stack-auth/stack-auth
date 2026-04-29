/**
 * Latency benchmark for the elysia backend. Hits a few representative endpoints
 * sequentially so we can see whether slow requests are warm-up artifacts or persistent.
 *
 * Usage: pnpm exec tsx scripts/benchmark.ts [--url=http://localhost:8102] [--iterations=50] [--concurrency=1]
 */

type Sample = {
  endpoint: string,
  status: number,
  ms: number,
};

type Endpoint = {
  name: string,
  method?: string,
  path: string,
  headers?: Record<string, string>,
  body?: unknown,
};

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [k, v] = arg.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  }),
);

const baseUrl = (args.url as string | undefined) ?? "http://localhost:8102";
const iterations = Number.parseInt((args.iterations as string | undefined) ?? "50", 10);
const concurrency = Number.parseInt((args.concurrency as string | undefined) ?? "1", 10);
const warmup = Number.parseInt((args.warmup as string | undefined) ?? "5", 10);

const internalHeaders: Record<string, string> = {
  "x-stack-access-type": "server",
  "x-stack-project-id": "internal",
  "x-stack-publishable-client-key": "this-publishable-client-key-is-for-local-development-only",
  "x-stack-secret-server-key": "this-secret-server-key-is-for-local-development-only",
};

const endpoints: Endpoint[] = [
  { name: "health", path: "/health" },
  { name: "health-db", path: "/health?db=1" },
  { name: "404", path: "/api/this/path/does/not/exist", headers: internalHeaders },
  { name: "options preflight", method: "OPTIONS", path: "/api/v1/users", headers: { ...internalHeaders, origin: "http://localhost:3000", "access-control-request-method": "POST" } },
  { name: "GET users (list)", path: "/api/v1/users", headers: internalHeaders },
  { name: "POST users (create)", method: "POST", path: "/api/v1/users", headers: { ...internalHeaders, "content-type": "application/json" }, body: {} },
  { name: "GET teams", path: "/api/v1/teams", headers: internalHeaders },
  { name: "GET projects/current", path: "/api/v1/projects/current", headers: { ...internalHeaders, "x-stack-access-type": "client" } },
];

async function runOne(ep: Endpoint): Promise<Sample> {
  const init: RequestInit = {
    method: ep.method ?? "GET",
    headers: ep.headers,
    body: ep.body == null ? undefined : JSON.stringify(ep.body),
  };
  const start = performance.now();
  const res = await fetch(`${baseUrl}${ep.path}`, init);
  await res.arrayBuffer();
  const ms = performance.now() - start;
  return { endpoint: ep.name, status: res.status, ms };
}

function summarize(samples: Sample[]) {
  const sorted = [...samples].sort((a, b) => a.ms - b.ms);
  const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]?.ms ?? 0;
  const sum = sorted.reduce((a, s) => a + s.ms, 0);
  return {
    count: sorted.length,
    min: sorted[0]?.ms ?? 0,
    p50: pct(50),
    p90: pct(90),
    p95: pct(95),
    p99: pct(99),
    max: sorted[sorted.length - 1]?.ms ?? 0,
    avg: sorted.length ? sum / sorted.length : 0,
    statuses: Array.from(new Set(sorted.map((s) => s.status))),
  };
}

async function runEndpoint(ep: Endpoint) {
  // Warmup to avoid one-time module load / connection setup dominating the first sample.
  for (let i = 0; i < warmup; i++) {
    await runOne(ep).catch(() => undefined);
  }

  const samples: Sample[] = [];
  if (concurrency <= 1) {
    for (let i = 0; i < iterations; i++) {
      samples.push(await runOne(ep));
    }
  } else {
    const tasks: Promise<void>[] = [];
    let started = 0;
    for (let c = 0; c < concurrency; c++) {
      tasks.push((async () => {
        while (started < iterations) {
          started++;
          samples.push(await runOne(ep));
        }
      })());
    }
    await Promise.all(tasks);
  }
  return { ep, summary: summarize(samples), samples };
}

function fmt(n: number) {
  return n < 10 ? n.toFixed(1) : n.toFixed(0);
}

(async () => {
  console.log(`Benchmark @ ${baseUrl} — iters=${iterations}, conc=${concurrency}, warmup=${warmup}`);
  console.log(`${"endpoint".padEnd(30)}${"status".padStart(8)}${"min".padStart(8)}${"p50".padStart(8)}${"p90".padStart(8)}${"p95".padStart(8)}${"p99".padStart(8)}${"max".padStart(9)}${"avg".padStart(8)}`);
  for (const ep of endpoints) {
    try {
      const { summary } = await runEndpoint(ep);
      const statuses = summary.statuses.join(",");
      console.log(`${ep.name.padEnd(30)}${statuses.padStart(8)}${fmt(summary.min).padStart(8)}${fmt(summary.p50).padStart(8)}${fmt(summary.p90).padStart(8)}${fmt(summary.p95).padStart(8)}${fmt(summary.p99).padStart(8)}${fmt(summary.max).padStart(9)}${fmt(summary.avg).padStart(8)}`);
    } catch (e) {
      console.log(`${ep.name.padEnd(30)} ERROR ${e instanceof Error ? e.message : String(e)}`);
    }
  }
})();
