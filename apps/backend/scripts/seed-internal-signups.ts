/* eslint-disable no-restricted-syntax */
/**
 * Seeds the dummy project with a bulk batch of fake user sign-ups and
 * realistic activity data spread across recent history and various
 * geographic regions. Populates:
 *
 *   1. ProjectUser rows (via usersCrudHandlers.adminCreate) with back-dated
 *      signedUpAt/createdAt so the Postgres sign-up metrics show a
 *      realistic curve.
 *   2. $token-refresh events in ClickHouse with geolocated ip_info so the
 *      DAU/MAU splits and "users by country" widgets reflect varied data.
 *   3. $page-view events in ClickHouse so the analytics overview shows
 *      realistic daily visitors, page views, and top referrers.
 *   4. $click events in ClickHouse so the clicks chart is populated.
 *
 * Usage:
 *   pnpm --filter @stackframe/backend run db:seed-signups
 *   pnpm --filter @stackframe/backend run db:seed-signups -- --count 500 --days 60
 *
 * The script is keyed on deterministic emails, so re-running it will not
 * duplicate users — it will update the existing rows' timestamps instead.
 */
import { usersCrudHandlers } from '@/app/api/latest/users/crud';
import { getClickhouseAdminClient } from '@/lib/clickhouse';
import { DEFAULT_BRANCH_ID, getSoleTenancyFromProjectBranch } from '@/lib/tenancies';
import { getPrismaClientForTenancy } from '@/prisma-client';
import { generateUuid } from '@stackframe/stack-shared/dist/utils/uuids';

const DUMMY_PROJECT_ID = '6fbbf22e-f4b2-4c6e-95a1-beab6fa41063';

// ── CLI args ─────────────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  let count = 500;
  let days = 60;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--count' && args[i + 1]) {
      count = parseInt(args[++i]!, 10);
    } else if (args[i] === '--days' && args[i + 1]) {
      days = parseInt(args[++i]!, 10);
    }
  }
  return { count, days };
}

// ── Deterministic PRNG (mulberry32) ──────────────────────────────────────────
function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Geographic fixtures ──────────────────────────────────────────────────────
type Region = {
  country: string,
  region: string,
  city: string,
  lat: number,
  lon: number,
  tz: string,
  weight: number,
  ipPrefix: string,
};

const REGIONS: Region[] = [
  // North America
  { country: 'US', region: 'CA', city: 'San Francisco', lat: 37.7749, lon: -122.4194, tz: 'America/Los_Angeles', weight: 18, ipPrefix: '104.16' },
  { country: 'US', region: 'NY', city: 'New York', lat: 40.7128, lon: -74.0060, tz: 'America/New_York', weight: 14, ipPrefix: '23.56' },
  { country: 'US', region: 'TX', city: 'Austin', lat: 30.2672, lon: -97.7431, tz: 'America/Chicago', weight: 6, ipPrefix: '68.54' },
  { country: 'US', region: 'WA', city: 'Seattle', lat: 47.6062, lon: -122.3321, tz: 'America/Los_Angeles', weight: 5, ipPrefix: '52.10' },
  { country: 'CA', region: 'ON', city: 'Toronto', lat: 43.6532, lon: -79.3832, tz: 'America/Toronto', weight: 5, ipPrefix: '99.240' },
  { country: 'CA', region: 'BC', city: 'Vancouver', lat: 49.2827, lon: -123.1207, tz: 'America/Vancouver', weight: 3, ipPrefix: '206.75' },
  { country: 'MX', region: 'CMX', city: 'Mexico City', lat: 19.4326, lon: -99.1332, tz: 'America/Mexico_City', weight: 2, ipPrefix: '189.148' },

  // Europe
  { country: 'GB', region: 'ENG', city: 'London', lat: 51.5074, lon: -0.1278, tz: 'Europe/London', weight: 10, ipPrefix: '90.196' },
  { country: 'DE', region: 'BE', city: 'Berlin', lat: 52.5200, lon: 13.4050, tz: 'Europe/Berlin', weight: 7, ipPrefix: '91.64' },
  { country: 'FR', region: 'IDF', city: 'Paris', lat: 48.8566, lon: 2.3522, tz: 'Europe/Paris', weight: 5, ipPrefix: '82.64' },
  { country: 'NL', region: 'NH', city: 'Amsterdam', lat: 52.3676, lon: 4.9041, tz: 'Europe/Amsterdam', weight: 3, ipPrefix: '145.14' },
  { country: 'ES', region: 'MD', city: 'Madrid', lat: 40.4168, lon: -3.7038, tz: 'Europe/Madrid', weight: 3, ipPrefix: '85.55' },
  { country: 'IT', region: 'LAZ', city: 'Rome', lat: 41.9028, lon: 12.4964, tz: 'Europe/Rome', weight: 2, ipPrefix: '93.41' },
  { country: 'PL', region: 'MZ', city: 'Warsaw', lat: 52.2297, lon: 21.0122, tz: 'Europe/Warsaw', weight: 2, ipPrefix: '178.42' },
  { country: 'SE', region: 'AB', city: 'Stockholm', lat: 59.3293, lon: 18.0686, tz: 'Europe/Stockholm', weight: 2, ipPrefix: '81.229' },
  { country: 'IE', region: 'D', city: 'Dublin', lat: 53.3498, lon: -6.2603, tz: 'Europe/Dublin', weight: 2, ipPrefix: '185.2' },

  // Asia-Pacific
  { country: 'IN', region: 'KA', city: 'Bangalore', lat: 12.9716, lon: 77.5946, tz: 'Asia/Kolkata', weight: 9, ipPrefix: '157.48' },
  { country: 'IN', region: 'MH', city: 'Mumbai', lat: 19.0760, lon: 72.8777, tz: 'Asia/Kolkata', weight: 4, ipPrefix: '14.140' },
  { country: 'JP', region: '13', city: 'Tokyo', lat: 35.6762, lon: 139.6503, tz: 'Asia/Tokyo', weight: 5, ipPrefix: '126.209' },
  { country: 'SG', region: '01', city: 'Singapore', lat: 1.3521, lon: 103.8198, tz: 'Asia/Singapore', weight: 3, ipPrefix: '165.21' },
  { country: 'AU', region: 'NSW', city: 'Sydney', lat: -33.8688, lon: 151.2093, tz: 'Australia/Sydney', weight: 3, ipPrefix: '203.2' },
  { country: 'KR', region: '11', city: 'Seoul', lat: 37.5665, lon: 126.9780, tz: 'Asia/Seoul', weight: 2, ipPrefix: '211.34' },
  { country: 'CN', region: 'SH', city: 'Shanghai', lat: 31.2304, lon: 121.4737, tz: 'Asia/Shanghai', weight: 2, ipPrefix: '114.88' },
  { country: 'ID', region: 'JK', city: 'Jakarta', lat: -6.2088, lon: 106.8456, tz: 'Asia/Jakarta', weight: 1, ipPrefix: '103.47' },

  // South America / MEA
  { country: 'BR', region: 'SP', city: 'São Paulo', lat: -23.5505, lon: -46.6333, tz: 'America/Sao_Paulo', weight: 3, ipPrefix: '177.66' },
  { country: 'AR', region: 'C', city: 'Buenos Aires', lat: -34.6037, lon: -58.3816, tz: 'America/Argentina/Buenos_Aires', weight: 1, ipPrefix: '181.45' },
  { country: 'ZA', region: 'GT', city: 'Johannesburg', lat: -26.2041, lon: 28.0473, tz: 'Africa/Johannesburg', weight: 1, ipPrefix: '41.76' },
  { country: 'AE', region: 'DU', city: 'Dubai', lat: 25.2048, lon: 55.2708, tz: 'Asia/Dubai', weight: 1, ipPrefix: '94.200' },
  { country: 'NG', region: 'LA', city: 'Lagos', lat: 6.5244, lon: 3.3792, tz: 'Africa/Lagos', weight: 1, ipPrefix: '102.89' },
];

const REGION_WEIGHT_TOTAL = REGIONS.reduce((sum, r) => sum + r.weight, 0);
function pickRegion(rand: () => number): Region {
  const roll = rand() * REGION_WEIGHT_TOTAL;
  let acc = 0;
  for (const r of REGIONS) {
    acc += r.weight;
    if (roll < acc) return r;
  }
  return REGIONS[REGIONS.length - 1]!;
}

// ── Name fixtures ────────────────────────────────────────────────────────────
const FIRST_NAMES = [
  'Alex', 'Jordan', 'Taylor', 'Morgan', 'Riley', 'Quinn', 'Avery', 'Dakota',
  'Casey', 'Hayden', 'Cameron', 'Rowan', 'Sage', 'Blake', 'Emery', 'Skyler',
  'Reese', 'Peyton', 'Eden', 'Finley', 'Kendall', 'Aubrey', 'Drew', 'Jesse',
  'Parker', 'Robin', 'Sydney', 'River', 'Harley', 'Milan', 'Aarav', 'Yuki',
  'Mateo', 'Nia', 'Omar', 'Priya', 'Kai', 'Luca', 'Zara', 'Ines', 'Noa',
];
const LAST_NAMES = [
  'Kim', 'Liu', 'Patel', 'Garcia', 'Brown', 'Davis', 'Wilson', 'Martinez',
  'Anderson', 'Thomas', 'Jackson', 'White', 'Harris', 'Clark', 'Lewis',
  'Robinson', 'Walker', 'Young', 'Allen', 'Scott', 'Adams', 'Nelson', 'Hill',
  'Moore', 'Hall', 'King', 'Wright', 'Green', 'Baker', 'Turner', 'Okafor',
  'Suzuki', 'Schneider', 'Dubois', 'Rossi', 'Nakamura', 'Silva', 'Ivanov',
];
const OAUTH_PROVIDERS = ['google', 'github', 'microsoft'];

// ── Referrer fixtures for realistic $page-view events ────────────────────────
const REFERRERS = [
  { url: 'https://www.google.com/', weight: 32 },
  { url: 'https://github.com/', weight: 18 },
  { url: 'https://twitter.com/', weight: 12 },
  { url: 'https://www.producthunt.com/', weight: 8 },
  { url: '', weight: 20 },  // direct traffic
  { url: 'https://news.ycombinator.com/', weight: 6 },
  { url: 'https://www.reddit.com/', weight: 4 },
];
const REFERRER_WEIGHT_TOTAL = REFERRERS.reduce((sum, r) => sum + r.weight, 0);
function pickReferrer(rand: () => number): string {
  const roll = rand() * REFERRER_WEIGHT_TOTAL;
  let acc = 0;
  for (const r of REFERRERS) {
    acc += r.weight;
    if (roll < acc) return r.url;
  }
  return '';
}

// ── Page path fixtures for $page-view events ─────────────────────────────────
const PAGE_PATHS = [
  '/', '/pricing', '/docs', '/docs/getting-started', '/docs/api-reference',
  '/blog', '/blog/announcing-v2', '/about', '/contact', '/changelog',
  '/dashboard', '/settings', '/settings/profile', '/settings/billing',
  '/integrations', '/features', '/enterprise',
];

function fakeIp(prefix: string, rand: () => number): string {
  const c = Math.floor(rand() * 256);
  const d = Math.floor(rand() * 254) + 1;
  return `${prefix}.${c}.${d}`;
}

// ── Time distribution ────────────────────────────────────────────────────────
function randomTimestampOnDay(now: Date, daysAgo: number, rand: () => number): Date {
  const ts = new Date(now);
  ts.setUTCDate(ts.getUTCDate() - daysAgo);
  const hour = 8 + Math.floor(rand() * 14);
  ts.setUTCHours(hour, Math.floor(rand() * 60), Math.floor(rand() * 60), Math.floor(rand() * 1000));
  return ts;
}

/**
 * Distribute `count` sign-ups across `days` with a gentle growth curve:
 *  - linear ramp from ~0.5× average at the oldest day to ~1.5× at the newest
 *  - ±25% jitter per day
 *  - light weekend dip (Sat/Sun) to look realistic
 * Returns an array of `daysAgo` offsets, one per user.
 */
function distributeSignups(count: number, days: number, rand: () => number, now: Date): number[] {
  const dayWeights: number[] = [];
  for (let d = 0; d < days; d++) {
    const ramp = 0.5 + (d / Math.max(1, days - 1));
    const jitter = 0.75 + rand() * 0.5;
    const date = new Date(now);
    date.setUTCDate(date.getUTCDate() - (days - 1 - d));
    const dow = date.getUTCDay();
    const weekend = (dow === 0 || dow === 6) ? 0.65 : 1.0;
    dayWeights.push(ramp * jitter * weekend);
  }
  const total = dayWeights.reduce((a, b) => a + b, 0);
  const offsets: number[] = [];
  for (let d = 0; d < days; d++) {
    const share = Math.round((dayWeights[d]! / total) * count);
    const daysAgoOffset = days - 1 - d;
    for (let i = 0; i < share; i++) offsets.push(daysAgoOffset);
  }
  while (offsets.length < count) offsets.push(Math.floor(rand() * days));
  while (offsets.length > count) offsets.pop();
  return offsets;
}

function formatClickhouseTimestamp(date: Date): string {
  return date.toISOString().replace('T', ' ').slice(0, 23);
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  process.env.STACK_SEED_MODE = 'true';

  const { count, days } = parseArgs();
  const now = new Date();
  const rand = prng(0xC0FFEE);

  console.log(`[seed-activity] Loading dummy project tenancy...`);
  const tenancy = await getSoleTenancyFromProjectBranch(DUMMY_PROJECT_ID, DEFAULT_BRANCH_ID);
  const prisma = await getPrismaClientForTenancy(tenancy);
  const clickhouse = getClickhouseAdminClient();

  console.log(`[seed-activity] Target: ${count} users across ${days} days in project "${tenancy.project.id}" branch "${tenancy.branchId}"`);

  const dayOffsets = distributeSignups(count, days, rand, now);
  const clickhouseRows: Array<Record<string, unknown>> = [];

  let created = 0;
  let updated = 0;

  // Track all user IDs + their signup day offset for activity generation
  const userActivity: Array<{ userId: string, signupDaysAgo: number, region: Region }> = [];

  for (let i = 0; i < count; i++) {
    const firstName = FIRST_NAMES[Math.floor(rand() * FIRST_NAMES.length)]!;
    const lastName = LAST_NAMES[Math.floor(rand() * LAST_NAMES.length)]!;
    const displayName = `${firstName} ${lastName}`;
    const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}.signupseed${i}@dummy.dev`;
    const signedUpAt = randomTimestampOnDay(now, dayOffsets[i]!, rand);
    const region = pickRegion(rand);
    const hasOauth = rand() > 0.55;
    const oauthProvider = hasOauth
      ? [{ id: OAUTH_PROVIDERS[Math.floor(rand() * OAUTH_PROVIDERS.length)]!, account_id: `${email}-oauth`, email }]
      : [];

    const existing = await prisma.projectUser.findFirst({
      where: {
        tenancyId: tenancy.id,
        contactChannels: { some: { type: 'EMAIL', value: email } },
      },
      select: { projectUserId: true },
    });

    let userId: string;
    if (existing) {
      userId = existing.projectUserId;
      updated++;
    } else {
      const createdUser = await usersCrudHandlers.adminCreate({
        tenancy,
        data: {
          display_name: displayName,
          primary_email: email,
          primary_email_auth_enabled: true,
          primary_email_verified: rand() > 0.25,
          otp_auth_enabled: false,
          is_anonymous: false,
          oauth_providers: oauthProvider,
          profile_image_url: null,
        },
      });
      userId = createdUser.id;
      created++;
    }

    await prisma.projectUser.updateMany({
      where: { tenancyId: tenancy.id, projectUserId: userId },
      data: { createdAt: signedUpAt, signedUpAt },
    });

    userActivity.push({ userId, signupDaysAgo: dayOffsets[i]!, region });

    // One $token-refresh at signup time
    const ipInfoForUser = {
      ip: fakeIp(region.ipPrefix, rand),
      is_trusted: true,
      country_code: region.country,
      region_code: region.region,
      city_name: region.city,
      latitude: region.lat,
      longitude: region.lon,
      tz_identifier: region.tz,
    };

    clickhouseRows.push({
      event_type: '$token-refresh',
      event_at: formatClickhouseTimestamp(signedUpAt),
      data: {
        refresh_token_id: generateUuid(),
        is_anonymous: false,
        ip_info: ipInfoForUser,
      },
      project_id: tenancy.project.id,
      branch_id: tenancy.branchId,
      user_id: userId,
      team_id: null,
    });

    if ((i + 1) % 100 === 0) {
      console.log(`[seed-activity] ${i + 1}/${count} users processed (${created} new, ${updated} updated)`);
    }
  }

  console.log(`[seed-activity] Generating multi-day activity events for ${userActivity.length} users...`);

  // For each user, generate returning activity on subsequent days after signup.
  // ~70% of users are active on multiple days; active users revisit 2–8 times
  // spread across the window between signup and today.
  for (const { userId, signupDaysAgo, region } of userActivity) {
    if (signupDaysAgo === 0) continue; // signed up today, no return visits yet
    const isReturning = rand() < 0.7;
    if (!isReturning) continue;

    const returnVisits = 2 + Math.floor(rand() * 7); // 2-8 return days
    const ipInfo = {
      ip: fakeIp(region.ipPrefix, rand),
      is_trusted: true,
      country_code: region.country,
      region_code: region.region,
      city_name: region.city,
      latitude: region.lat,
      longitude: region.lon,
      tz_identifier: region.tz,
    };

    for (let v = 0; v < returnVisits; v++) {
      // Pick a random day between signup and today (exclusive of signup day)
      const visitDaysAgo = Math.floor(rand() * signupDaysAgo);
      const visitTime = randomTimestampOnDay(now, visitDaysAgo, rand);

      // $token-refresh (drives DAU/MAU)
      clickhouseRows.push({
        event_type: '$token-refresh',
        event_at: formatClickhouseTimestamp(visitTime),
        data: {
          refresh_token_id: generateUuid(),
          is_anonymous: false,
          ip_info: ipInfo,
        },
        project_id: tenancy.project.id,
        branch_id: tenancy.branchId,
        user_id: userId,
        team_id: null,
      });

      // $page-view (drives daily_visitors, daily_page_views, top_referrers)
      const pageViewCount = 1 + Math.floor(rand() * 4); // 1-4 page views per visit
      for (let p = 0; p < pageViewCount; p++) {
        const pvOffset = Math.floor(rand() * 3600) * 1000; // within the hour
        const pvTime = new Date(visitTime.getTime() + pvOffset);
        clickhouseRows.push({
          event_type: '$page-view',
          event_at: formatClickhouseTimestamp(pvTime),
          data: {
            path: PAGE_PATHS[Math.floor(rand() * PAGE_PATHS.length)],
            referrer: p === 0 ? pickReferrer(rand) : '',
            is_anonymous: false,
          },
          project_id: tenancy.project.id,
          branch_id: tenancy.branchId,
          user_id: userId,
          team_id: null,
        });
      }

      // $click (drives daily_clicks) — ~40% of visits produce a click
      if (rand() < 0.4) {
        const clickOffset = Math.floor(rand() * 1800) * 1000;
        const clickTime = new Date(visitTime.getTime() + clickOffset);
        clickhouseRows.push({
          event_type: '$click',
          event_at: formatClickhouseTimestamp(clickTime),
          data: {
            selector: 'button.cta-primary',
            is_anonymous: false,
          },
          project_id: tenancy.project.id,
          branch_id: tenancy.branchId,
          user_id: userId,
          team_id: null,
        });
      }
    }
  }

  console.log(`[seed-activity] Flushing ${clickhouseRows.length} events to ClickHouse...`);
  const BATCH = 500;
  for (let i = 0; i < clickhouseRows.length; i += BATCH) {
    const batch = clickhouseRows.slice(i, i + BATCH);
    await clickhouse.insert({
      table: 'analytics_internal.events',
      values: batch,
      format: 'JSONEachRow',
      clickhouse_settings: {
        date_time_input_format: 'best_effort',
        async_insert: 1,
      },
    });
  }

  const tokenRefreshCount = clickhouseRows.filter(r => r.event_type === '$token-refresh').length;
  const pageViewCount = clickhouseRows.filter(r => r.event_type === '$page-view').length;
  const clickCount = clickhouseRows.filter(r => r.event_type === '$click').length;

  console.log(`[seed-activity] Done. created=${created} updated=${updated}`);
  console.log(`[seed-activity] Events: $token-refresh=${tokenRefreshCount} $page-view=${pageViewCount} $click=${clickCount} total=${clickhouseRows.length}`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
