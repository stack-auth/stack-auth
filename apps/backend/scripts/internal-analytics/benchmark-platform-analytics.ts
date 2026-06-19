/**
 * Local-only benchmark harness for the queries in
 * apps/backend/src/app/api/latest/internal/platform-analytics/route.tsx.
 *
 * Seeds an ISOLATED ClickHouse database (`bench_pa`) and Postgres schema
 * (`bench_pa`) with synthetic data at a configurable scale, then runs every CH
 * and PG query from the route verbatim (table refs rewritten to the scratch
 * db/schema) and records duration / memory / rows-read from system.query_log
 * (CH) and EXPLAIN (ANALYZE, BUFFERS) (PG).
 *
 * Defaults model the scale this route is expected to face:
 *   - 10,000 projects, 1,000,000 users, power-law (top project ~10% of users)
 *   - 50,000,000 ClickHouse events (~50/user), single branch "main"
 *
 * Run:
 *   pnpm --filter @hexclave/backend run with-env:dev tsx scripts/benchmark-platform-analytics.ts
 * Env knobs:
 *   PA_PROJECTS (10000) PA_USERS (1000000) PA_EVENTS (50000000)
 *   PA_SKIP_SEED=1   reuse an already-seeded bench_pa
 *   PA_KEEP=1        do not drop bench_pa at the end
 *   PA_OUT           output json path (default /tmp/platform-analytics-bench.json)
 *
 * NOTE: this harness captures the ORIGINAL (pre-optimization) query shapes so it
 * can be used as a baseline. See optimize-platform-analytics.ts and
 * optimize-split.ts for the variant comparisons that justify the route changes.
 */
import { getClickhouseAdminClient, getClickhouseAdminClientForMetrics } from "@/lib/clickhouse";
import { globalPrismaClient } from "@/prisma-client";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";

function envInt(name: string, fallback: number): number {
  const v = getEnvVariable(name, "");
  if (v === "") return fallback;
  return Number(v);
}
function envBool(name: string): boolean {
  return ["1", "true"].includes(getEnvVariable(name, ""));
}

const NUM_PROJECTS = envInt("PA_PROJECTS", 10_000);
const NUM_USERS = envInt("PA_USERS", 1_000_000);
const NUM_EVENTS = envInt("PA_EVENTS", 50_000_000);
const ZIPF_K = 4; // top project ~ (1/N)^(1/k) of users => k=4 gives ~10%
const BRANCH = "main";
const OUT = getEnvVariable("PA_OUT", "/tmp/platform-analytics-bench.json");

const chAdmin = getClickhouseAdminClient();
const chMetrics = getClickhouseAdminClientForMetrics();

function log(...a: unknown[]) {
  console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
}

// ---------- window math (mirror the route) ----------
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 30;
const now = new Date();
const todayUtc = new Date(now);
todayUtc.setUTCHours(0, 0, 0, 0);
const windowStart = new Date(todayUtc.getTime() - (WINDOW_DAYS - 1) * ONE_DAY_MS);
const priorStart = new Date(todayUtc.getTime() - (2 * WINDOW_DAYS - 1) * ONE_DAY_MS);
const untilExclusive = new Date(todayUtc.getTime() + ONE_DAY_MS);
const chDT = (d: Date) => d.toISOString().slice(0, 19);
const sinceParam = chDT(windowStart);
const midParam = chDT(windowStart);
const priorSinceParam = chDT(priorStart);
const untilParam = chDT(untilExclusive);

// =====================================================================
// SEEDING
// =====================================================================
async function seedClickhouse() {
  log("CH: drop+create bench_pa");
  await chAdmin.command({ query: "DROP DATABASE IF EXISTS bench_pa" });
  await chAdmin.command({ query: "CREATE DATABASE bench_pa" });
  for (const t of ["events", "users", "contact_channels", "teams", "connected_accounts", "email_outboxes", "clickmap_events"]) {
    await chAdmin.command({ query: `CREATE TABLE bench_pa.${t} AS analytics_internal.${t}` });
  }

  // project index for a given numeric key (power-law)
  const projExpr = (key: string) =>
    `concat('bench-proj-', toString(toUInt32(floor(${NUM_PROJECTS} * pow((cityHash64(${key}) % 1000000)/1000000.0, ${ZIPF_K})))))`;
  const uuidExpr = (key: string) => `reinterpretAsUUID(MD5(toString(${key})))`;
  const ccExpr = `['US','DE','IN','BR','GB','FR','JP','CA','AU','NL'][(cityHash64(number,'cc') % 10)+1]`;

  // ---- events: NUM_EVENTS rows, ~NUM_EVENTS/NUM_USERS per user, spread 90d ----
  const CHUNK = 5_000_000;
  for (let off = 0; off < NUM_EVENTS; off += CHUNK) {
    const n = Math.min(CHUNK, NUM_EVENTS - off);
    await chAdmin.command({
      query: `
      INSERT INTO bench_pa.events
      SELECT
        ['$token-refresh','$token-refresh','$token-refresh','$token-refresh','$token-refresh','$token-refresh','$token-refresh','$page-view','$page-view','$click'][((number+${off}) % 10)+1] AS event_type,
        now64(3,'UTC') - toIntervalSecond(cityHash64(number+${off},'t') % (90*86400)) AS event_at,
        CAST(concat('{"is_anonymous":', toString(toUInt8(cityHash64((number+${off}) % ${NUM_USERS},'a') % 10 = 0)),
          ',"ip_info":{"country_code":"', ${ccExpr}, '"},"referrer":""}'), 'JSON') AS data,
        ${projExpr(`(number+${off}) % ${NUM_USERS}`)} AS project_id,
        '${BRANCH}' AS branch_id,
        toString((number+${off}) % ${NUM_USERS}) AS user_id,
        NULL AS team_id, NULL AS refresh_token_id, NULL AS session_replay_id, NULL AS session_replay_segment_id,
        now64(3,'UTC') AS created_at
      FROM numbers(${n})`,
    });
    log(`CH events: ${(off + n).toLocaleString()} / ${NUM_EVENTS.toLocaleString()}`);
  }

  // ---- users: 1 per user; signed_up spread over 365d; ~10% anonymous ----
  log("CH: seeding users");
  await chAdmin.command({
    query: `
    INSERT INTO bench_pa.users
    SELECT
      ${projExpr("number")} AS project_id, '${BRANCH}' AS branch_id, ${uuidExpr("number")} AS id,
      NULL AS display_name, NULL AS profile_image_url, concat('u', toString(number), '@ex.com') AS primary_email,
      toUInt8(cityHash64(number,'v') % 10 < 7) AS primary_email_verified,
      now64(3,'UTC') - toIntervalSecond(cityHash64(number,'s') % (365*86400)) AS signed_up_at,
      '{}' AS client_metadata, '{}' AS client_read_only_metadata, '{}' AS server_metadata,
      toUInt8(cityHash64(number,'a') % 10 = 0) AS is_anonymous,
      0 AS restricted_by_admin, NULL AS restricted_by_admin_reason, NULL AS restricted_by_admin_private_details,
      toInt64(number) AS sync_sequence_id, 0 AS sync_is_deleted, now64(3,'UTC') AS sync_created_at
    FROM numbers(${NUM_USERS})`,
  });

  // ---- contact_channels: verified EMAIL for ~70% of users (matches users.id) ----
  log("CH: seeding contact_channels");
  await chAdmin.command({
    query: `
    INSERT INTO bench_pa.contact_channels
    SELECT
      ${projExpr("number")} AS project_id, '${BRANCH}' AS branch_id,
      reinterpretAsUUID(MD5(concat('cc', toString(number)))) AS id, ${uuidExpr("number")} AS user_id,
      'EMAIL' AS type, concat('u', toString(number), '@ex.com') AS value,
      1 AS is_primary, 1 AS is_verified, 1 AS used_for_auth,
      now64(3,'UTC') AS created_at, toInt64(number) AS sync_sequence_id, 0 AS sync_is_deleted, now64(3,'UTC') AS sync_created_at
    FROM numbers(${NUM_USERS}) WHERE cityHash64(number,'v') % 10 < 7`,
  });

  // ---- teams (~150k), connected_accounts (~300k), email_outboxes (~500k) ----
  log("CH: seeding teams / connected_accounts / email_outboxes");
  await chAdmin.command({
    query: `
    INSERT INTO bench_pa.teams
    SELECT ${projExpr("number")} AS project_id, '${BRANCH}' AS branch_id,
      reinterpretAsUUID(MD5(concat('tm', toString(number)))) AS id, concat('Team ', toString(number)) AS display_name,
      NULL AS profile_image_url, now64(3,'UTC') AS created_at, '{}' AS client_metadata, '{}' AS client_read_only_metadata,
      '{}' AS server_metadata, toInt64(number) AS sync_sequence_id, 0 AS sync_is_deleted, now64(3,'UTC') AS sync_created_at
    FROM numbers(150000)`,
  });
  await chAdmin.command({
    query: `
    INSERT INTO bench_pa.connected_accounts
    SELECT ${projExpr("number")} AS project_id, '${BRANCH}' AS branch_id, ${uuidExpr("number")} AS user_id,
      ['google','github','microsoft'][(number%3)+1] AS provider, concat('pa', toString(number)) AS provider_account_id,
      now64(3,'UTC') AS created_at, toInt64(number) AS sync_sequence_id, 0 AS sync_is_deleted, now64(3,'UTC') AS sync_created_at
    FROM numbers(300000)`,
  });
  await chAdmin.command({
    query: `
    INSERT INTO bench_pa.email_outboxes
    SELECT ${projExpr("number")} AS project_id, '${BRANCH}' AS branch_id,
      reinterpretAsUUID(MD5(concat('eo', toString(number)))) AS id, 'SENT' AS status, 'OK' AS simple_status,
      'API' AS created_with, NULL AS email_draft_id, NULL AS email_programmatic_call_template_id, NULL AS theme_id,
      0 AS is_high_priority, 1 AS is_transactional, 'Subj' AS subject, NULL AS notification_category_id,
      NULL AS started_rendering_at, NULL AS rendered_at, NULL AS render_error, now64(3,'UTC') AS scheduled_at,
      now64(3,'UTC') AS created_at, now64(3,'UTC') AS updated_at, NULL AS started_sending_at, NULL AS server_error,
      NULL AS delivered_at, NULL AS opened_at, NULL AS clicked_at, NULL AS unsubscribed_at, NULL AS marked_as_spam_at,
      NULL AS bounced_at, NULL AS delivery_delayed_at, NULL AS can_have_delivery_info, NULL AS skipped_reason,
      NULL AS skipped_details, 0 AS send_retries, 0 AS is_paused, toInt64(number) AS sync_sequence_id, 0 AS sync_is_deleted, now64(3,'UTC') AS sync_created_at
    FROM numbers(500000)`,
  });

  // ---- clickmap_events (~2M, ~5% dead) ----
  log("CH: seeding clickmap_events");
  await chAdmin.command({
    query: `
    INSERT INTO bench_pa.clickmap_events
    SELECT ${projExpr("number")} AS project_id, '${BRANCH}' AS branch_id,
      now64(3,'UTC') - toIntervalSecond(cityHash64(number,'t') % (90*86400)) AS event_at,
      toString(number % ${NUM_USERS}) AS user_id, NULL AS session_replay_id,
      'https://app.example.com/x' AS url, '/x' AS path, 1280 AS viewport_width, 800 AS viewport_height,
      100 AS pointer_x, 200 AS pointer_y, 200 AS client_y, 0.1 AS pointer_relative_x, 0 AS pointer_target_fixed,
      '' AS elements_chain, 'button' AS selector, 'Click' AS elements_text, 'button' AS tag_name, NULL AS href,
      toUInt8(cityHash64(number,'d') % 20 = 0) AS is_dead
    FROM numbers(2000000)`,
  });

  await chAdmin.command({ query: "SYSTEM FLUSH LOGS" });
  for (const t of ["events", "users", "contact_channels", "teams", "connected_accounts", "email_outboxes", "clickmap_events"]) {
    const r = await (await chAdmin.query({ query: `SELECT count() c FROM bench_pa.${t}`, format: "JSONEachRow" })).json<{ c: string }>();
    log(`  bench_pa.${t}: ${Number(r[0].c).toLocaleString()} rows`);
  }
}

async function seedPostgres() {
  log("PG: drop+create schema bench_pa");
  const ex = (sql: string) => globalPrismaClient.$executeRawUnsafe(sql);
  await ex("DROP SCHEMA IF EXISTS bench_pa CASCADE");
  await ex("CREATE SCHEMA bench_pa");
  await ex(`CREATE UNLOGGED TABLE bench_pa."Tenancy" (id uuid PRIMARY KEY, "projectId" text, "branchId" text)`);
  await ex(`CREATE UNLOGGED TABLE bench_pa."SubscriptionInvoice" ("tenancyId" uuid, status text, "amountTotal" int, "createdAt" timestamptz)`);
  await ex(`CREATE UNLOGGED TABLE bench_pa."Subscription" ("tenancyId" uuid, status text, product jsonb, "priceId" text, quantity int)`);
  await ex(`CREATE UNLOGGED TABLE bench_pa."AuthMethod" ("tenancyId" uuid, id uuid, PRIMARY KEY("tenancyId", id))`);
  await ex(`CREATE UNLOGGED TABLE bench_pa."OAuthAuthMethod" ("tenancyId" uuid, "authMethodId" uuid, "configOAuthProviderId" text, PRIMARY KEY("tenancyId","authMethodId"))`);
  await ex(`CREATE UNLOGGED TABLE bench_pa."PasswordAuthMethod" ("tenancyId" uuid, "authMethodId" uuid, PRIMARY KEY("tenancyId","authMethodId"))`);
  await ex(`CREATE UNLOGGED TABLE bench_pa."PasskeyAuthMethod" ("tenancyId" uuid, "authMethodId" uuid, PRIMARY KEY("tenancyId","authMethodId"))`);
  await ex(`CREATE UNLOGGED TABLE bench_pa."OtpAuthMethod" ("tenancyId" uuid, "authMethodId" uuid, PRIMARY KEY("tenancyId","authMethodId"))`);
  await ex(`CREATE UNLOGGED TABLE bench_pa."EmailOutbox" ("tenancyId" uuid, "finishedSendingAt" timestamptz, "deliveredAt" timestamptz, "bouncedAt" timestamptz, "simpleStatus" text, "createdAt" timestamptz)`);
  await ex(`CREATE UNLOGGED TABLE bench_pa."SessionReplay" ("tenancyId" uuid)`);

  // tenancy: one per project. deterministic uuid via md5.
  await ex(`INSERT INTO bench_pa."Tenancy"(id,"projectId","branchId")
    SELECT md5('ten'||g)::uuid, 'bench-proj-'||g, '${BRANCH}' FROM generate_series(0, ${NUM_PROJECTS - 1}) g`);

  // helper: a tenancy id drawn with power-law (concentrate on low-index projects)
  const zipfTen = `md5('ten'|| floor(${NUM_PROJECTS} * power(random(), ${ZIPF_K}))::int )::uuid`;
  const days90 = `now() - (random()*90) * interval '1 day'`;

  log("PG: seeding SubscriptionInvoice (200k)");
  await ex(`INSERT INTO bench_pa."SubscriptionInvoice"("tenancyId",status,"amountTotal","createdAt")
    SELECT ${zipfTen}, (ARRAY['paid','paid','paid','succeeded','void','open'])[1+floor(random()*6)::int],
      (500 + floor(random()*50000))::int, ${days90} FROM generate_series(1,200000)`);

  log("PG: seeding Subscription (60k)");
  await ex(`INSERT INTO bench_pa."Subscription"("tenancyId",status,product,"priceId",quantity)
    SELECT ${zipfTen}, (ARRAY['active','active','active','trialing','paused','canceled'])[1+floor(random()*6)::int],
      jsonb_build_object('prices', jsonb_build_object('price_main',
        jsonb_build_object('interval', jsonb_build_array('month', 1), 'USD', (5+floor(random()*95))::text || '.99'))),
      'price_main', (1+floor(random()*5))::int FROM generate_series(1,60000)`);

  log("PG: seeding AuthMethod (1M) + subtypes");
  await ex(`INSERT INTO bench_pa."AuthMethod"("tenancyId",id)
    SELECT ${zipfTen}, md5('am'||g)::uuid FROM generate_series(0, ${NUM_USERS - 1}) g`);
  await ex(`INSERT INTO bench_pa."OAuthAuthMethod"("tenancyId","authMethodId","configOAuthProviderId")
    SELECT "tenancyId", id, (ARRAY['google','github','microsoft','gitlab'])[1+floor(random()*4)::int]
    FROM bench_pa."AuthMethod" WHERE (('x'||substr(md5(id::text),1,8))::bit(32)::int) % 2 = 0`);
  await ex(`INSERT INTO bench_pa."PasswordAuthMethod"("tenancyId","authMethodId")
    SELECT "tenancyId", id FROM bench_pa."AuthMethod" WHERE (('x'||substr(md5(id::text),1,8))::bit(32)::int) % 10 IN (1,2,3)`);
  await ex(`INSERT INTO bench_pa."OtpAuthMethod"("tenancyId","authMethodId")
    SELECT "tenancyId", id FROM bench_pa."AuthMethod" WHERE (('x'||substr(md5(id::text),1,8))::bit(32)::int) % 10 IN (4,5)`);
  await ex(`INSERT INTO bench_pa."PasskeyAuthMethod"("tenancyId","authMethodId")
    SELECT "tenancyId", id FROM bench_pa."AuthMethod" WHERE (('x'||substr(md5(id::text),1,8))::bit(32)::int) % 20 = 7`);

  log("PG: seeding EmailOutbox (1M)");
  await ex(`INSERT INTO bench_pa."EmailOutbox"("tenancyId","finishedSendingAt","deliveredAt","bouncedAt","simpleStatus","createdAt")
    SELECT ${zipfTen},
      CASE WHEN random() < 0.95 THEN now() ELSE NULL END,
      CASE WHEN random() < 0.88 THEN now() ELSE NULL END,
      CASE WHEN random() < 0.02 THEN now() ELSE NULL END,
      (ARRAY['OK','OK','OK','OK','IN_PROGRESS','ERROR'])[1+floor(random()*6)::int], ${days90}
    FROM generate_series(1,1000000)`);

  log("PG: seeding SessionReplay (100k)");
  await ex(`INSERT INTO bench_pa."SessionReplay"("tenancyId") SELECT ${zipfTen} FROM generate_series(1,100000)`);

  log("PG: secondary indexes + ANALYZE");
  for (const t of ["SubscriptionInvoice", "Subscription", "EmailOutbox", "SessionReplay"]) {
    await ex(`CREATE INDEX ON bench_pa."${t}" ("tenancyId")`);
  }
  await ex(`ANALYZE bench_pa."Tenancy", bench_pa."SubscriptionInvoice", bench_pa."Subscription", bench_pa."AuthMethod", bench_pa."OAuthAuthMethod", bench_pa."PasswordAuthMethod", bench_pa."PasskeyAuthMethod", bench_pa."OtpAuthMethod", bench_pa."EmailOutbox", bench_pa."SessionReplay"`);
  const cnt = await globalPrismaClient.$queryRawUnsafe<Array<{ t: string, c: bigint }>>(`
    SELECT 'Tenancy' t, count(*) c FROM bench_pa."Tenancy"
    UNION ALL SELECT 'SubscriptionInvoice', count(*) FROM bench_pa."SubscriptionInvoice"
    UNION ALL SELECT 'Subscription', count(*) FROM bench_pa."Subscription"
    UNION ALL SELECT 'AuthMethod', count(*) FROM bench_pa."AuthMethod"
    UNION ALL SELECT 'EmailOutbox', count(*) FROM bench_pa."EmailOutbox"
    UNION ALL SELECT 'SessionReplay', count(*) FROM bench_pa."SessionReplay"`);
  for (const r of cnt) log(`  bench_pa.${r.t}: ${Number(r.c).toLocaleString()} rows`);
}

// =====================================================================
// QUERIES (verbatim from route.tsx, table refs -> bench_pa)
// =====================================================================
const T = "bench_pa"; // CH database
const baseParams = { branchId: BRANCH, internalProjectId: "internal" };
const windowParams = { ...baseParams, since: sinceParam, until: untilParam };
const twoWindowParams = { ...baseParams, priorSince: priorSinceParam, mid: midParam, until: untilParam };
const userCountsParams = { ...baseParams, mid: midParam };
const customerEventScope = `project_id != {internalProjectId:String}`;
const customerUserScope = `branch_id = {branchId:String} AND sync_is_deleted = 0 AND project_id != {internalProjectId:String}`;
const verifiedSubquery = `
  (project_id, id) IN (
    SELECT project_id, user_id FROM ${T}.contact_channels FINAL
    WHERE branch_id = {branchId:String} AND sync_is_deleted = 0 AND type = 'EMAIL' AND is_verified = 1
  )`;

type CountRow = { projectId: string, c: string | number };
type ChQ = { name: string, what: string, sql: string, params: Record<string, unknown> };
const CH_QUERIES: ChQ[] = [
  { name: "dauSeries", what: "Daily active users/day over 30d window (uniqExact user_id on $token-refresh)", params: windowParams, sql: `
    SELECT toDate(event_at) AS day, uniqExact(assumeNotNull(user_id)) AS c FROM ${T}.events
    WHERE event_type = '$token-refresh' AND user_id IS NOT NULL AND ${customerEventScope}
      AND event_at >= {since:DateTime} AND event_at < {until:DateTime} GROUP BY day ORDER BY day ASC` },
  { name: "pvSeries", what: "Page views + unique visitors per day over 30d ($page-view/$click)", params: windowParams, sql: `
    SELECT toDate(event_at) AS day, countIf(event_type='$page-view') AS pv,
      uniqExactIf(assumeNotNull(user_id), event_type='$page-view') AS visitors FROM ${T}.events
    WHERE event_type IN ('$page-view','$click') AND ${customerEventScope}
      AND event_at >= {since:DateTime} AND event_at < {until:DateTime} GROUP BY day ORDER BY day ASC` },
  { name: "signupSeries", what: "Signups/day over 30d (users FINAL, non-anon)", params: windowParams, sql: `
    SELECT toDate(signed_up_at,'UTC') AS day, count() AS c FROM ${T}.users FINAL
    WHERE ${customerUserScope} AND is_anonymous = 0
      AND signed_up_at >= {since:DateTime} AND signed_up_at < {until:DateTime} GROUP BY day ORDER BY day ASC` },
  { name: "mauProjects", what: "MAU + active projects, current vs prior 30d in one 60d pass", params: twoWindowParams, sql: `
    SELECT uniqExactIf(assumeNotNull(user_id), event_at >= {mid:DateTime}) AS mauCur,
      uniqExactIf(assumeNotNull(user_id), event_at < {mid:DateTime}) AS mauPrev,
      uniqExactIf(project_id, event_at >= {mid:DateTime}) AS projCur,
      uniqExactIf(project_id, event_at < {mid:DateTime}) AS projPrev FROM ${T}.events
    WHERE event_type='$token-refresh' AND user_id IS NOT NULL AND ${customerEventScope}
      AND event_at >= {priorSince:DateTime} AND event_at < {until:DateTime}` },
  { name: "userCounts", what: "Total/verified/anonymous user stock (users FINAL, verified via contact_channels IN-subquery)", params: userCountsParams, sql: `
    SELECT countIf(is_anonymous=0) AS total, countIf(is_anonymous=0 AND signed_up_at < {mid:DateTime}) AS totalPrev,
      countIf(is_anonymous=0 AND ${verifiedSubquery}) AS verified,
      countIf(is_anonymous=0 AND signed_up_at < {mid:DateTime} AND ${verifiedSubquery}) AS verifiedPrev,
      countIf(is_anonymous=1) AS anonymous FROM ${T}.users FINAL WHERE ${customerUserScope}` },
  { name: "country", what: "Users by country over 30d (argMax country per user)", params: windowParams, sql: `
    SELECT country_code, count() AS c FROM (
      SELECT user_id, argMax(cc, event_at) AS country_code FROM (
        SELECT user_id, event_at, CAST(data.ip_info.country_code,'Nullable(String)') AS cc FROM ${T}.events
        WHERE event_type='$token-refresh' AND user_id IS NOT NULL AND ${customerEventScope}
          AND event_at >= {since:DateTime} AND event_at < {until:DateTime}
      ) WHERE cc IS NOT NULL GROUP BY user_id
    ) WHERE country_code IS NOT NULL GROUP BY country_code ORDER BY c DESC` },
  { name: "deadClicks", what: "Dead-click rate over 30d (clickmap_events)", params: windowParams, sql: `
    SELECT count() AS clicks, sum(is_dead) AS dead FROM ${T}.clickmap_events
    WHERE ${customerEventScope} AND event_at >= {since:DateTime} AND event_at < {until:DateTime}` },
  { name: "split", what: "New/retained/reactivated split (window fn + all-history LEFT JOIN for first_date)", params: windowParams, sql: `
    SELECT toString(w.day) AS day, count() AS total_count,
      countIf(f.first_date = w.day) AS new_count,
      countIf(f.first_date < w.day AND w.prev_day = addDays(w.day,-1)) AS retained_count,
      countIf(f.first_date < w.day AND (isNull(w.prev_day) OR w.prev_day < addDays(w.day,-1))) AS reactivated_count
    FROM (
      SELECT day, entity_id, lagInFrame(day,1) OVER (PARTITION BY entity_id ORDER BY day) AS prev_day FROM (
        SELECT DISTINCT toDate(event_at) AS day, assumeNotNull(user_id) AS entity_id FROM ${T}.events
        WHERE event_type='$token-refresh' AND user_id IS NOT NULL AND ${customerEventScope}
          AND event_at >= {since:DateTime} AND event_at < {until:DateTime}
          AND coalesce(CAST(data.is_anonymous,'Nullable(UInt8)'),0)=0
      )
    ) AS w LEFT JOIN (
      SELECT assumeNotNull(user_id) AS entity_id, toDate(min(event_at)) AS first_date FROM ${T}.events
      WHERE event_type='$token-refresh' AND user_id IS NOT NULL AND ${customerEventScope}
        AND event_at < {until:DateTime} AND coalesce(CAST(data.is_anonymous,'Nullable(UInt8)'),0)=0 GROUP BY entity_id
    ) AS f USING (entity_id) GROUP BY w.day ORDER BY w.day ASC` },
  { name: "totalsByProject", what: "Per-project total users (users FINAL)", params: baseParams, sql: `
    SELECT project_id AS projectId, count() AS c FROM ${T}.users FINAL WHERE ${customerUserScope} AND is_anonymous=0 GROUP BY project_id` },
  { name: "verifiedByProject", what: "Per-project verified users (users FINAL + verified IN-subquery)", params: baseParams, sql: `
    SELECT project_id AS projectId, count() AS c FROM ${T}.users FINAL WHERE ${customerUserScope} AND is_anonymous=0 AND ${verifiedSubquery} GROUP BY project_id` },
  { name: "signupsByProject", what: "Per-project signups cur vs prior (users FINAL)", params: twoWindowParams, sql: `
    SELECT project_id AS projectId, countIf(signed_up_at >= {mid:DateTime}) AS cur, countIf(signed_up_at < {mid:DateTime}) AS prev
    FROM ${T}.users FINAL WHERE ${customerUserScope} AND is_anonymous=0
      AND signed_up_at >= {priorSince:DateTime} AND signed_up_at < {until:DateTime} GROUP BY project_id` },
  { name: "activeByProject", what: "Per-project active users cur vs prior (events)", params: twoWindowParams, sql: `
    SELECT project_id AS projectId, uniqExactIf(assumeNotNull(user_id), event_at >= {mid:DateTime}) AS cur,
      uniqExactIf(assumeNotNull(user_id), event_at < {mid:DateTime}) AS prev FROM ${T}.events
    WHERE event_type='$token-refresh' AND user_id IS NOT NULL AND ${customerEventScope}
      AND event_at >= {priorSince:DateTime} AND event_at < {until:DateTime} GROUP BY project_id` },
  { name: "sparkByProject", what: "Per-project daily active sparkline over 30d (events)", params: windowParams, sql: `
    SELECT project_id AS projectId, toDate(event_at) AS day, uniqExact(assumeNotNull(user_id)) AS c FROM ${T}.events
    WHERE event_type='$token-refresh' AND user_id IS NOT NULL AND ${customerEventScope}
      AND event_at >= {since:DateTime} AND event_at < {until:DateTime} GROUP BY project_id, day` },
  { name: "teamsByProject", what: "Feature adoption: teams per project (teams FINAL)", params: baseParams, sql: `
    SELECT project_id AS projectId, count() AS c FROM ${T}.teams FINAL WHERE ${customerUserScope} GROUP BY project_id` },
  { name: "oauthByProject", what: "Feature adoption: connected_accounts per project (FINAL)", params: baseParams, sql: `
    SELECT project_id AS projectId, count() AS c FROM ${T}.connected_accounts FINAL WHERE ${customerUserScope} GROUP BY project_id` },
  { name: "emailsByProject", what: "Feature adoption: email_outboxes per project (FINAL)", params: baseParams, sql: `
    SELECT project_id AS projectId, count() AS c FROM ${T}.email_outboxes FINAL WHERE ${customerUserScope} GROUP BY project_id` },
  { name: "analyticsByProject", what: "Feature adoption: $page-view per project (events, branch-filtered)", params: baseParams, sql: `
    SELECT project_id AS projectId, count() AS c FROM ${T}.events
    WHERE event_type='$page-view' AND branch_id = {branchId:String} AND ${customerEventScope} GROUP BY project_id` },
];

const INTERNAL = "internal";
type PgQ = { name: string, what: string, sql: string };
const PG_QUERIES: PgQ[] = [
  { name: "revenueDaily", what: "Daily revenue over 30d (SubscriptionInvoice JOIN Tenancy)", sql: `
    SELECT TO_CHAR(si."createdAt"::date,'YYYY-MM-DD') AS day, COALESCE(SUM(si."amountTotal"),0)::bigint AS cents
    FROM bench_pa."SubscriptionInvoice" si JOIN bench_pa."Tenancy" t ON t.id=si."tenancyId"
    WHERE si."amountTotal" IS NOT NULL AND si.status = ANY(ARRAY['paid','succeeded'])
      AND si."createdAt" >= $1 AND t."projectId" <> '${INTERNAL}' GROUP BY day ORDER BY day` },
  { name: "revenueByProject", what: "Per-project revenue cur vs prior (SubscriptionInvoice JOIN Tenancy)", sql: `
    SELECT t."projectId" AS "projectId",
      COALESCE(SUM("amountTotal") FILTER (WHERE si."createdAt" >= $1),0)::bigint AS cur,
      COALESCE(SUM("amountTotal") FILTER (WHERE si."createdAt" < $1),0)::bigint AS prev
    FROM bench_pa."SubscriptionInvoice" si JOIN bench_pa."Tenancy" t ON t.id=si."tenancyId"
    WHERE si."amountTotal" IS NOT NULL AND si.status = ANY(ARRAY['paid','succeeded'])
      AND si."createdAt" >= $2 AND t."projectId" <> '${INTERNAL}' GROUP BY t."projectId"` },
  { name: "subscriptions", what: "All active/trialing subs for MRR (Subscription JOIN Tenancy)", sql: `
    SELECT t."projectId" AS "projectId", s.product AS product, s."priceId" AS "priceId", s.quantity AS quantity
    FROM bench_pa."Subscription" s JOIN bench_pa."Tenancy" t ON t.id=s."tenancyId"
    WHERE s.status::text = ANY(ARRAY['active','trialing']) AND t."projectId" <> '${INTERNAL}'` },
  { name: "authMethods", what: "Auth-method split (AuthMethod + 4 LEFT JOINs to subtype tables)", sql: `
    SELECT method, COUNT(*)::int AS count FROM (
      SELECT COALESCE(oaam."configOAuthProviderId"::text,
        CASE WHEN pam."authMethodId" IS NOT NULL THEN 'password' END,
        CASE WHEN pkm."authMethodId" IS NOT NULL THEN 'passkey' END,
        CASE WHEN oam."authMethodId" IS NOT NULL THEN 'otp' END, 'other') AS method
      FROM bench_pa."AuthMethod" am JOIN bench_pa."Tenancy" t ON t.id=am."tenancyId"
      LEFT JOIN bench_pa."OAuthAuthMethod" oaam ON oaam."tenancyId"=am."tenancyId" AND oaam."authMethodId"=am.id
      LEFT JOIN bench_pa."PasswordAuthMethod" pam ON pam."tenancyId"=am."tenancyId" AND pam."authMethodId"=am.id
      LEFT JOIN bench_pa."PasskeyAuthMethod" pkm ON pkm."tenancyId"=am."tenancyId" AND pkm."authMethodId"=am.id
      LEFT JOIN bench_pa."OtpAuthMethod" oam ON oam."tenancyId"=am."tenancyId" AND oam."authMethodId"=am.id
      WHERE t."projectId" <> '${INTERNAL}') sub GROUP BY method ORDER BY count DESC` },
  { name: "email", what: "Email deliverability counters (EmailOutbox JOIN Tenancy)", sql: `
    SELECT COUNT(*) FILTER (WHERE eo."finishedSendingAt" IS NOT NULL)::int AS sent,
      COUNT(*) FILTER (WHERE eo."deliveredAt" IS NOT NULL)::int AS delivered,
      COUNT(*) FILTER (WHERE eo."bouncedAt" IS NOT NULL)::int AS bounced,
      COUNT(*) FILTER (WHERE eo."simpleStatus"::text='ERROR')::int AS error,
      COUNT(*) FILTER (WHERE eo."simpleStatus"::text='IN_PROGRESS')::int AS in_progress,
      COUNT(*) FILTER (WHERE eo."deliveredAt" IS NOT NULL AND eo."createdAt" >= $1)::int AS "deliveredCur",
      COUNT(*) FILTER (WHERE eo."finishedSendingAt" IS NOT NULL AND eo."createdAt" >= $1)::int AS "finishedCur",
      COUNT(*) FILTER (WHERE eo."deliveredAt" IS NOT NULL AND eo."createdAt" >= $2 AND eo."createdAt" < $1)::int AS "deliveredPrev",
      COUNT(*) FILTER (WHERE eo."finishedSendingAt" IS NOT NULL AND eo."createdAt" >= $2 AND eo."createdAt" < $1)::int AS "finishedPrev"
    FROM bench_pa."EmailOutbox" eo JOIN bench_pa."Tenancy" t ON t.id=eo."tenancyId" WHERE t."projectId" <> '${INTERNAL}'` },
  { name: "paymentsRows", what: "DISTINCT projects with a sub (Subscription JOIN Tenancy)", sql: `
    SELECT DISTINCT t."projectId" AS "projectId" FROM bench_pa."Subscription" s JOIN bench_pa."Tenancy" t ON t.id=s."tenancyId"
    WHERE s.status IN ('active','trialing','paused') AND t."projectId" <> '${INTERNAL}'` },
  { name: "replayRows", what: "DISTINCT projects with session replay (SessionReplay JOIN Tenancy)", sql: `
    SELECT DISTINCT t."projectId" AS "projectId" FROM bench_pa."SessionReplay" sr JOIN bench_pa."Tenancy" t ON t.id=sr."tenancyId"
    WHERE t."projectId" <> '${INTERNAL}'` },
];

const PG_PARAMS: Record<string, unknown[]> = {
  revenueDaily: [windowStart],
  revenueByProject: [windowStart, priorStart],
  subscriptions: [],
  authMethods: [],
  email: [windowStart, priorStart],
  paymentsRows: [],
  replayRows: [],
};

// =====================================================================
// RUN + MEASURE
// =====================================================================
type ChResult = { name: string, what: string, durationMs: number, memMiB: number, readRows: number, readMiB: number, resultRows: number, error?: string };
async function runChQuery(q: ChQ): Promise<ChResult> {
  const reps = 3;
  let best: ChResult | null = null;
  for (let i = 0; i < reps; i++) {
    const queryId = `pa-${q.name}-${randomUUID()}`;
    try {
      const r = await chMetrics.query({ query: q.sql, query_params: q.params, query_id: queryId, format: "JSONEachRow" });
      await r.json();
      await chMetrics.command({ query: "SYSTEM FLUSH LOGS" });
      const stat = await (await chMetrics.query({
        query: `SELECT query_duration_ms, memory_usage, read_rows, read_bytes, result_rows
                FROM system.query_log WHERE query_id={qid:String} AND type='QueryFinish' ORDER BY event_time DESC LIMIT 1`,
        query_params: { qid: queryId }, format: "JSONEachRow",
      })).json<{ query_duration_ms: string, memory_usage: string, read_rows: string, read_bytes: string, result_rows: string }>();
      const s = stat[0];
      const res: ChResult = {
        name: q.name, what: q.what,
        durationMs: Number(s.query_duration_ms), memMiB: Number(s.memory_usage) / 1048576,
        readRows: Number(s.read_rows), readMiB: Number(s.read_bytes) / 1048576,
        resultRows: Number(s.result_rows),
      };
      if (!best || res.durationMs < best.durationMs) best = res;
    } catch (e) {
      return { name: q.name, what: q.what, durationMs: -1, memMiB: 0, readRows: 0, readMiB: 0, resultRows: 0, error: (e as Error).message.slice(0, 200) };
    }
  }
  return best!;
}

type PgResult = { name: string, what: string, durationMs: number, planMs: number, sharedHitMiB: number, sharedReadMiB: number, rows: number, plan: string, error?: string };
async function runPgQuery(q: PgQ): Promise<PgResult> {
  const params = PG_PARAMS[q.name] ?? [];
  const reps = 3;
  let best: PgResult | null = null;
  for (let i = 0; i < reps; i++) {
    try {
      const explainSql = `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${q.sql}`;
      const rows = await globalPrismaClient.$queryRawUnsafe<Array<{ "QUERY PLAN": unknown }>>(explainSql, ...params);
      const planArr = rows[0]["QUERY PLAN"] as Array<{ Plan: Record<string, unknown>, "Execution Time": number, "Planning Time": number }>;
      const p = planArr[0];
      const top = p.Plan;
      const sharedHit = Number(top["Shared Hit Blocks"] ?? 0) + sumChildren(top, "Shared Hit Blocks");
      const sharedRead = Number(top["Shared Read Blocks"] ?? 0) + sumChildren(top, "Shared Read Blocks");
      const res: PgResult = {
        name: q.name, what: q.what,
        durationMs: Number(p["Execution Time"]), planMs: Number(p["Planning Time"]),
        sharedHitMiB: (sharedHit * 8192) / 1048576, sharedReadMiB: (sharedRead * 8192) / 1048576,
        rows: Number(top["Actual Rows"] ?? 0), plan: topNodes(top),
      };
      if (!best || res.durationMs < best.durationMs) best = res;
    } catch (e) {
      return { name: q.name, what: q.what, durationMs: -1, planMs: 0, sharedHitMiB: 0, sharedReadMiB: 0, rows: 0, plan: "", error: (e as Error).message.slice(0, 200) };
    }
  }
  return best!;
}
function sumChildren(node: Record<string, unknown>, key: string): number {
  const plans = (node.Plans as Array<Record<string, unknown>> | undefined) ?? [];
  let s = 0;
  for (const c of plans) s += Number(c[key] ?? 0) + sumChildren(c, key);
  return s;
}
function topNodes(node: Record<string, unknown>, depth = 0): string {
  const t = String(node["Node Type"] ?? "");
  const rel = node["Relation Name"] ? ` ${node["Relation Name"]}` : "";
  let s = `${"  ".repeat(depth)}${t}${rel} (rows=${node["Actual Rows"]})`;
  const plans = (node.Plans as Array<Record<string, unknown>> | undefined) ?? [];
  for (const c of plans.slice(0, 3)) s += "\n" + topNodes(c, depth + 1);
  return s;
}

async function main() {
  log(`scale: ${NUM_PROJECTS.toLocaleString()} projects, ${NUM_USERS.toLocaleString()} users, ${NUM_EVENTS.toLocaleString()} CH events`);
  if (!envBool("PA_SKIP_SEED")) {
    const s0 = Date.now();
    await seedClickhouse();
    await seedPostgres();
    log(`seeding done in ${((Date.now() - s0) / 1000).toFixed(0)}s`);
  } else {
    log("PA_SKIP_SEED=1 -> reusing existing bench_pa");
  }

  log("running ClickHouse queries...");
  const chResults: ChResult[] = [];
  for (const q of CH_QUERIES) {
    const r = await runChQuery(q);
    chResults.push(r);
    log(`  CH ${q.name}: ${r.error ? "ERR " + r.error : `${r.durationMs}ms, ${r.memMiB.toFixed(0)}MiB, read ${r.readRows.toLocaleString()} rows`}`);
  }

  log("running Postgres queries...");
  const pgResults: PgResult[] = [];
  for (const q of PG_QUERIES) {
    const r = await runPgQuery(q);
    pgResults.push(r);
    log(`  PG ${q.name}: ${r.error ? "ERR " + r.error : `${r.durationMs.toFixed(0)}ms, ${(r.sharedHitMiB + r.sharedReadMiB).toFixed(0)}MiB buffers`}`);
  }

  const out = {
    generatedAt: new Date().toISOString(),
    scale: { projects: NUM_PROJECTS, users: NUM_USERS, events: NUM_EVENTS, zipfK: ZIPF_K },
    window: { since: sinceParam, prior: priorSinceParam, until: untilParam },
    clickhouse: chResults, postgres: pgResults,
    chTotal: { sumMemMiB: chResults.reduce((s, r) => s + r.memMiB, 0), maxMs: Math.max(...chResults.map(r => r.durationMs)), sumMs: chResults.reduce((s, r) => s + Math.max(0, r.durationMs), 0) },
    pgTotal: { sumMs: pgResults.reduce((s, r) => s + Math.max(0, r.durationMs), 0), maxMs: Math.max(...pgResults.map(r => r.durationMs)) },
  };
  writeFileSync(OUT, JSON.stringify(out, null, 2));
  log(`wrote ${OUT}`);

  if (!envBool("PA_KEEP")) {
    log("cleanup: dropping bench_pa (CH + PG)");
    await chAdmin.command({ query: "DROP DATABASE IF EXISTS bench_pa" });
    await globalPrismaClient.$executeRawUnsafe("DROP SCHEMA IF EXISTS bench_pa CASCADE");
  }
  process.exit(0);
}

try {
  await main();
} catch (e) {
  console.error("BENCH FAILED:", e);
  process.exit(1);
}
