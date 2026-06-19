/**
 * Focused optimization of the platform-analytics "activity split"
 * (new/retained/reactivated) ClickHouse query. Tests exact rewrites AND
 * approximate (user-sampled) variants, measuring peak memory + accuracy.
 *
 * This is what justified shipping ACTIVITY_SPLIT_SAMPLE in route.tsx: at 1M
 * users / 50M events, 1-in-4 consistent user sampling cut the split's peak
 * memory ~78% (1.3 GiB -> ~0.3 GiB) for a ~0.4% mean error.
 *
 * Run: pnpm --filter @hexclave/backend run with-env:dev tsx scripts/optimize-split.ts
 * Env: PA_SKIP_SEED=1 PA_KEEP=1 PA_EVENTS PA_USERS PA_PROJECTS
 */
import { getClickhouseAdminClient, getClickhouseAdminClientForMetrics, METRICS_CLICKHOUSE_SETTINGS } from "@/lib/clickhouse";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";

const envInt = (n: string, f: number) => {
  const v = getEnvVariable(n, "");
  return v === "" ? f : Number(v);
};
const envBool = (n: string) => ["1", "true"].includes(getEnvVariable(n, ""));
const NUM_PROJECTS = envInt("PA_PROJECTS", 10_000), NUM_USERS = envInt("PA_USERS", 1_000_000), NUM_EVENTS = envInt("PA_EVENTS", 50_000_000);
const ZIPF_K = 4, BRANCH = "main", INTERNAL = "internal";
const chAdmin = getClickhouseAdminClient();
const chMetrics = getClickhouseAdminClientForMetrics();
const log = (...a: unknown[]) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

const ONE_DAY_MS = 86400000, WINDOW_DAYS = 30;
const now = new Date();
const todayUtc = new Date(now);
todayUtc.setUTCHours(0, 0, 0, 0);
const windowStart = new Date(todayUtc.getTime() - (WINDOW_DAYS - 1) * ONE_DAY_MS);
const untilExclusive = new Date(todayUtc.getTime() + ONE_DAY_MS);
const chDT = (d: Date) => d.toISOString().slice(0, 19);
const sinceParam = chDT(windowStart), startParam = chDT(windowStart), untilParam = chDT(untilExclusive);
const T = "bench_pa";
const params = { branchId: BRANCH, internalProjectId: INTERNAL, since: sinceParam, start: startParam, until: untilParam };

async function seed() {
  log("CH: (re)create bench_pa.events");
  await chAdmin.command({ query: "DROP DATABASE IF EXISTS bench_pa" });
  await chAdmin.command({ query: "CREATE DATABASE bench_pa" });
  await chAdmin.command({ query: "CREATE TABLE bench_pa.events AS analytics_internal.events" });
  const projExpr = (k: string) => `concat('bench-proj-', toString(toUInt32(floor(${NUM_PROJECTS} * pow((cityHash64(${k}) % 1000000)/1000000.0, ${ZIPF_K})))))`;
  const cc = `['US','DE','IN','BR','GB','FR','JP','CA','AU','NL'][(cityHash64(number,'cc') % 10)+1]`;
  const CHUNK = 5_000_000;
  for (let off = 0; off < NUM_EVENTS; off += CHUNK) {
    const n = Math.min(CHUNK, NUM_EVENTS - off);
    await chAdmin.command({ query: `INSERT INTO bench_pa.events SELECT
      ['$token-refresh','$token-refresh','$token-refresh','$token-refresh','$token-refresh','$token-refresh','$token-refresh','$page-view','$page-view','$click'][((number+${off}) % 10)+1],
      now64(3,'UTC') - toIntervalSecond(cityHash64(number+${off},'t') % (90*86400)),
      CAST(concat('{"is_anonymous":', toString(toUInt8(cityHash64((number+${off}) % ${NUM_USERS},'a') % 10 = 0)), ',"ip_info":{"country_code":"', ${cc}, '"},"referrer":""}'), 'JSON'),
      ${projExpr(`(number+${off}) % ${NUM_USERS}`)}, '${BRANCH}', toString((number+${off}) % ${NUM_USERS}), NULL, NULL, NULL, NULL, now64(3,'UTC')
      FROM numbers(${n})` });
    log(`  events ${(off + n).toLocaleString()}/${NUM_EVENTS.toLocaleString()}`);
  }
  log("seed done");
}

// classification expressions shared by exact variants
const NEW = "f.first_date=w.day", RET = "f.first_date<w.day AND w.prev_day=addDays(w.day,-1)", REA = "f.first_date<w.day AND (isNull(w.prev_day) OR w.prev_day<addDays(w.day,-1))";
const anon = "coalesce(CAST(data.is_anonymous,'Nullable(UInt8)'),0)=0";
const evScope = `event_type='$token-refresh' AND user_id IS NOT NULL AND project_id != {internalProjectId:String} AND ${anon}`;

function exactSql(entity: string) {
  return `SELECT toString(w.day) AS day, count() AS total_count, countIf(${NEW}) AS new_count, countIf(${RET}) AS retained_count, countIf(${REA}) AS reactivated_count
    FROM (SELECT day, entity_id, lagInFrame(day,1) OVER (PARTITION BY entity_id ORDER BY day) AS prev_day FROM (
      SELECT DISTINCT toDate(event_at) AS day, ${entity} AS entity_id FROM ${T}.events
      WHERE ${evScope} AND event_at>={since:DateTime} AND event_at<{until:DateTime})) AS w
    LEFT JOIN (SELECT ${entity} AS entity_id, toDate(min(event_at)) AS first_date FROM ${T}.events
      WHERE ${evScope} AND event_at<{until:DateTime} GROUP BY entity_id) AS f USING (entity_id)
    GROUP BY w.day ORDER BY w.day ASC`;
}

function boundedSql(entity: string) {
  return `WITH seen AS (SELECT DISTINCT ${entity} AS entity_id FROM ${T}.events WHERE ${evScope} AND event_at<{start:DateTime})
    SELECT toString(w.day) AS day, count() AS total_count,
      countIf(isNull(w.prev_day) AND w.seen_before=0) AS new_count,
      countIf(w.prev_day=addDays(w.day,-1)) AS retained_count,
      countIf((isNull(w.prev_day) AND w.seen_before=1) OR (isNotNull(w.prev_day) AND w.prev_day<addDays(w.day,-1))) AS reactivated_count
    FROM (SELECT day, entity_id, seen_before, lagInFrame(day,1) OVER (PARTITION BY entity_id ORDER BY day) AS prev_day FROM (
      SELECT d.day AS day, d.entity_id AS entity_id, (s.entity_id IS NOT NULL) AS seen_before FROM (
        SELECT DISTINCT toDate(event_at) AS day, ${entity} AS entity_id FROM ${T}.events
        WHERE ${evScope} AND event_at>={since:DateTime} AND event_at<{until:DateTime}) d
      LEFT JOIN seen s USING (entity_id))) AS w
    GROUP BY w.day ORDER BY w.day ASC`;
}

// APPROXIMATE: consistent user-level sampling 1/K (cityHash bucket), counts scaled by K
function sampledSql(K: number) {
  const samp = `AND cityHash64(assumeNotNull(user_id)) % ${K} = 0`;
  const entity = "sipHash64(assumeNotNull(user_id))";
  return `SELECT toString(w.day) AS day, count()*${K} AS total_count, countIf(${NEW})*${K} AS new_count, countIf(${RET})*${K} AS retained_count, countIf(${REA})*${K} AS reactivated_count
    FROM (SELECT day, entity_id, lagInFrame(day,1) OVER (PARTITION BY entity_id ORDER BY day) AS prev_day FROM (
      SELECT DISTINCT toDate(event_at) AS day, ${entity} AS entity_id FROM ${T}.events
      WHERE ${evScope} ${samp} AND event_at>={since:DateTime} AND event_at<{until:DateTime})) AS w
    LEFT JOIN (SELECT ${entity} AS entity_id, toDate(min(event_at)) AS first_date FROM ${T}.events
      WHERE ${evScope} ${samp} AND event_at<{until:DateTime} GROUP BY entity_id) AS f USING (entity_id)
    GROUP BY w.day ORDER BY w.day ASC`;
}

type Day = { day: string, total_count: number, new_count: number, retained_count: number, reactivated_count: number };
type Run = { mem: number, ms: number, readRows: number, rows: Day[] };
async function run(sql: string, settings?: Record<string, string>): Promise<Run> {
  let best: Run | null = null;
  for (let i = 0; i < 3; i++) {
    const qid = `split-${randomUUID()}`;
    const r = await chMetrics.query({ query: sql, query_params: params, query_id: qid, format: "JSONEachRow", clickhouse_settings: { ...METRICS_CLICKHOUSE_SETTINGS, ...settings } });
    const rows = (await r.json<Record<string, string>>()).map((x) => ({ day: x.day, total_count: Number(x.total_count), new_count: Number(x.new_count), retained_count: Number(x.retained_count), reactivated_count: Number(x.reactivated_count) }));
    await chMetrics.command({ query: "SYSTEM FLUSH LOGS" });
    const s = (await (await chMetrics.query({ query: `SELECT query_duration_ms d, memory_usage m, read_rows rr FROM system.query_log WHERE query_id={q:String} AND type='QueryFinish' ORDER BY event_time DESC LIMIT 1`, query_params: { q: qid }, format: "JSONEachRow" })).json<{ d: string, m: string, rr: string }>())[0];
    const run = { mem: Number(s.m) / 1048576, ms: Number(s.d), readRows: Number(s.rr), rows };
    if (!best || run.mem < best.mem) best = run;
  }
  return best!;
}

// accuracy vs exact ground truth: mean & max abs % error over days, per metric
function accuracy(truth: Day[], approx: Day[]) {
  const tm = new Map(truth.map((d) => [d.day, d]));
  const metrics = ["total_count", "new_count", "retained_count", "reactivated_count"] as const;
  const errsAll: number[] = [];
  const per: Record<string, { mean: number, max: number }> = {};
  for (const m of metrics) {
    const errs: number[] = [];
    for (const a of approx) {
      const t = tm.get(a.day);
      if (!t) continue;
      const tv = t[m], av = a[m];
      if (tv === 0) {
        if (av !== 0) errs.push(100);
        continue;
      }
      const e = Math.abs(av - tv) / tv * 100;
      errs.push(e);
      errsAll.push(e);
    }
    per[m] = { mean: errs.reduce((s, x) => s + x, 0) / Math.max(1, errs.length), max: Math.max(0, ...errs) };
  }
  return { per, overallMean: errsAll.reduce((s, x) => s + x, 0) / Math.max(1, errsAll.length), overallMax: Math.max(0, ...errsAll) };
}

async function main() {
  if (!envBool("PA_SKIP_SEED")) {
    await seed();
  } else {
    log("reusing bench_pa.events");
  }

  const cases: Array<{ name: string, kind: "exact" | "approx", sql: string, settings?: Record<string, string> }> = [
    { name: "original (string entity)", kind: "exact", sql: exactSql("assumeNotNull(user_id)") },
    { name: "sipHash entity", kind: "exact", sql: exactSql("sipHash64(assumeNotNull(user_id))") },
    { name: "exact bounded first_date (sipHash)", kind: "exact", sql: boundedSql("sipHash64(assumeNotNull(user_id))") },
    { name: "sipHash + max_threads=4", kind: "exact", sql: exactSql("sipHash64(assumeNotNull(user_id))"), settings: { max_threads: "4" } },
    { name: "sipHash + max_threads=2", kind: "exact", sql: exactSql("sipHash64(assumeNotNull(user_id))"), settings: { max_threads: "2" } },
    { name: "APPROX sample 1/4 (x4)", kind: "approx", sql: sampledSql(4) },
    { name: "APPROX sample 1/10 (x10)", kind: "approx", sql: sampledSql(10) },
    { name: "APPROX sample 1/20 (x20)", kind: "approx", sql: sampledSql(20) },
    { name: "APPROX sample 1/10 + max_threads=4", kind: "approx", sql: sampledSql(10), settings: { max_threads: "4" } },
  ];

  let truth: Day[] = [];
  const out: unknown[] = [];
  for (const c of cases) {
    const r = await run(c.sql, c.settings);
    if (c.name.startsWith("original")) truth = r.rows;
    const acc = c.kind === "approx" ? accuracy(truth, r.rows) : (c.name.startsWith("original") ? null : accuracy(truth, r.rows));
    const accStr = acc ? `err mean ${acc.overallMean.toFixed(1)}% max ${acc.overallMax.toFixed(1)}%` : (c.name.startsWith("original") ? "(ground truth)" : "exact");
    log(`  ${c.name.padEnd(38)} mem ${r.mem.toFixed(0).padStart(5)}MiB  ${r.ms.toFixed(0).padStart(5)}ms  read ${r.readRows.toLocaleString().padStart(13)}  ${accStr}`);
    out.push({ name: c.name, kind: c.kind, memMiB: r.mem, ms: r.ms, readRows: r.readRows, accuracy: acc, rows: r.rows });
  }
  writeFileSync("/tmp/split-optimize.json", JSON.stringify({ generatedAt: new Date().toISOString(), scale: { NUM_PROJECTS, NUM_USERS, NUM_EVENTS }, cases: out }, null, 2));
  log("wrote /tmp/split-optimize.json");
  if (!envBool("PA_KEEP")) {
    await chAdmin.command({ query: "DROP DATABASE IF EXISTS bench_pa" });
  }
  process.exit(0);
}

try {
  await main();
} catch (e) {
  console.error("FAILED:", e);
  process.exit(1);
}
