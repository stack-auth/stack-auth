/* eslint-disable no-restricted-syntax */
import { teamMembershipsCrudHandlers } from '@/app/api/latest/team-memberships/crud';
import { teamsCrudHandlers } from '@/app/api/latest/teams/crud';
import { usersCrudHandlers } from '@/app/api/latest/users/crud';
import { CustomerType, EmailOutboxCreatedWith, Prisma, PurchaseCreationSource, SubscriptionStatus } from '@/generated/prisma/client';
import { getClickhouseAdminClient } from '@/lib/clickhouse';
import { overrideBranchConfigOverride, overrideEnvironmentConfigOverride, setBranchConfigOverrideSource } from '@/lib/config';
import { createOrUpdateProjectWithLegacyConfig, getProject } from '@/lib/projects';
import { DEFAULT_BRANCH_ID, getSoleTenancyFromProjectBranch, type Tenancy } from '@/lib/tenancies';
import { getPrismaClientForTenancy, globalPrismaClient, type PrismaClientTransaction } from '@/prisma-client';
import { ALL_APPS } from '@stackframe/stack-shared/dist/apps/apps-config';
import { DEFAULT_EMAIL_THEME_ID } from '@stackframe/stack-shared/dist/helpers/emails';
import { type AdminUserProjectsCrud, type ProjectsCrud } from '@stackframe/stack-shared/dist/interface/crud/projects';
import { DayInterval } from '@stackframe/stack-shared/dist/utils/dates';
import { getEnvVariable } from '@stackframe/stack-shared/dist/utils/env';
import { throwErr } from '@stackframe/stack-shared/dist/utils/errors';
import { typedEntries, typedFromEntries } from '@stackframe/stack-shared/dist/utils/objects';
import { generateUuid } from '@stackframe/stack-shared/dist/utils/uuids';
import { createHash } from 'node:crypto';

const EXPLORATORY_TEAM_DISPLAY_NAME = 'Exploratory Research and Insight Partnership With Very Long Collaborative Name For Testing';

/**
 * Derive a stable v4-shaped UUID from a namespaced string so seed re-runs
 * upsert into existing rows instead of creating duplicates.
 */
function deterministicUuid(namespace: string): string {
  const hex = createHash('sha256').update(namespace).digest('hex');
  const a = hex.slice(0, 8);
  const b = hex.slice(8, 12);
  const c = '4' + hex.slice(13, 16);
  const d = ((parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16) + hex.slice(17, 20);
  const e = hex.slice(20, 32);
  return `${a}-${b}-${c}-${d}-${e}`;
}

/** Mulberry32 — small, fast, deterministic PRNG. */
function deterministicPrng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Convert a string into a deterministic 32-bit seed for `deterministicPrng`. */
function seedFromString(input: string): number {
  const hex = createHash('sha256').update(input).digest('hex').slice(0, 8);
  return parseInt(hex, 16) >>> 0;
}

function daysAgo(d: number, h: number = 12): Date {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - d);
  date.setHours(h, 0, 0, 0);
  return date;
}

// ============= Types =============

type TeamSeed = {
  displayName: string,
  profileImageUrl?: string,
};

type UserSeedOauthProvider = {
  providerId: string,
  accountId: string,
};

type UserSeed = {
  displayName?: string,
  email: string,
  profileImageUrl?: string,
  teamDisplayNames: string[],
  primaryEmailVerified: boolean,
  isAnonymous: boolean,
  oauthProviders: UserSeedOauthProvider[],
  createdAt?: Date,
};

type SeedDummyTeamsOptions = {
  prisma: PrismaClientTransaction,
  tenancy: Tenancy,
};

type SeedDummyUsersOptions = {
  prisma: PrismaClientTransaction,
  tenancy: Tenancy,
  teamNameToId: Map<string, string>,
};

type PaymentsSetup = {
  paymentsProducts: Record<string, unknown>,
  paymentsBranchOverride: Record<string, unknown>,
  paymentsEnvironmentOverride: Record<string, unknown>,
};

type TransactionsSeedOptions = {
  prisma: PrismaClientTransaction,
  tenancyId: string,
  teamNameToId: Map<string, string>,
  userEmailToId: Map<string, string>,
  paymentsProducts: Record<string, unknown>,
};

type EmailSeedOptions = {
  prisma: PrismaClientTransaction,
  tenancyId: string,
  userEmailToId: Map<string, string>,
};

type EmailOutboxSeed = {
  id: string,
  subject: string,
  html?: string,
  text?: string,
  createdAt: Date,
  userEmail?: string,
  hasError?: boolean,
};

type SessionActivityEventSeedOptions = {
  tenancyId: string,
  projectId: string,
  userEmailToId: Map<string, string>,
};

type BulkActivityRegion = {
  country: string,
  region: string,
  city: string,
  lat: number,
  lon: number,
  tz: string,
  weight: number,
  ipPrefix: string,
};

type SeedDummyProjectOptions = {
  projectId?: string,
  ownerTeamId: string,
  oauthProviderIds: string[],
  excludeAlphaApps?: boolean,
  skipGithubConfigSource?: boolean,
};

// ============= Seed Data =============

const teamSeeds: TeamSeed[] = [
  { displayName: 'Design Systems Lab', profileImageUrl: 'https://avatar.vercel.sh/design-systems?size=96&background=312e81&color=fff' },
  { displayName: 'Prototype Garage' },
  { displayName: EXPLORATORY_TEAM_DISPLAY_NAME, profileImageUrl: 'https://avatar.vercel.sh/exploratory-research?size=96&background=2563eb&color=fff' },
  { displayName: 'Launch Council', profileImageUrl: 'https://avatar.vercel.sh/launch-council?size=96&background=172554&color=fff' },
  { displayName: 'Growth Loop', profileImageUrl: 'https://avatar.vercel.sh/growth-loop?size=96&background=16a34a&color=fff' },
  { displayName: 'QA Collective' },
  { displayName: 'Customer Advisory Board', profileImageUrl: 'https://avatar.vercel.sh/customer-advisory?size=96&background=854d0e&color=fff' },
  { displayName: 'Ops', profileImageUrl: 'https://avatar.vercel.sh/ops-team?size=96&background=ea580c&color=fff' },
];

const userSeeds: UserSeed[] = [
  {
    displayName: 'Amelia Chen',
    email: 'amelia.chen@dummy.dev',
    teamDisplayNames: ['Design Systems Lab', 'Prototype Garage'],
    primaryEmailVerified: true,
    isAnonymous: false,
    oauthProviders: [
      { providerId: 'github', accountId: 'amelia-chen-gh' },
      { providerId: 'google', accountId: 'amelia-chen-google' },
    ],
    createdAt: daysAgo(28, 9),
  },
  {
    email: 'leo.park@dummy.dev',
    teamDisplayNames: ['Design Systems Lab', 'QA Collective'],
    primaryEmailVerified: false,
    isAnonymous: false,
    oauthProviders: [],
    createdAt: daysAgo(28, 15),
  },
  {
    displayName: 'Some-long-display-name with-middle-name with-last-name',
    email: 'isla.rodriguez@dummy.dev',
    teamDisplayNames: [EXPLORATORY_TEAM_DISPLAY_NAME, 'Customer Advisory Board'],
    primaryEmailVerified: true,
    isAnonymous: false,
    oauthProviders: [
      { providerId: 'google', accountId: 'isla-rodriguez-google' },
      { providerId: 'microsoft', accountId: 'isla-rodriguez-msft' },
    ],
    createdAt: daysAgo(25, 10),
  },
  {
    displayName: 'Al',
    email: 'milo.adeyemi@dummy.dev',
    teamDisplayNames: [EXPLORATORY_TEAM_DISPLAY_NAME, 'Launch Council'],
    primaryEmailVerified: true,
    isAnonymous: true,
    oauthProviders: [],
    createdAt: daysAgo(25, 16),
  },
  {
    displayName: 'Priya Narang',
    email: 'priya.narang@dummy.dev',
    teamDisplayNames: ['Launch Council', 'Ops'],
    primaryEmailVerified: false,
    isAnonymous: false,
    oauthProviders: [
      { providerId: 'spotify', accountId: 'priya-narang-spotify' },
      { providerId: 'github', accountId: 'priya-narang-gh' },
    ],
    createdAt: daysAgo(23, 8),
  },
  {
    displayName: 'Jonas Richter',
    email: 'jonas.richter@dummy.dev',
    profileImageUrl: 'https://avatar.vercel.sh/jonas-richter?size=96',
    teamDisplayNames: ['Launch Council', 'QA Collective'],
    primaryEmailVerified: true,
    isAnonymous: false,
    oauthProviders: [],
    createdAt: daysAgo(21, 14),
  },
  {
    displayName: 'Chioma Mensah',
    email: 'chioma.mensah@dummy.dev',
    profileImageUrl: 'https://avatar.vercel.sh/chioma-mensah?size=96',
    teamDisplayNames: ['Design Systems Lab', 'Ops'],
    primaryEmailVerified: false,
    isAnonymous: true,
    oauthProviders: [
      { providerId: 'google', accountId: 'chioma-mensah-google' },
      { providerId: 'microsoft', accountId: 'chioma-mensah-msft' },
    ],
    createdAt: daysAgo(21, 17),
  },
  {
    displayName: 'Nia Holloway',
    email: 'nia.holloway@dummy.dev',
    teamDisplayNames: ['QA Collective'],
    primaryEmailVerified: true,
    isAnonymous: false,
    oauthProviders: [],
    createdAt: daysAgo(18, 11),
  },
  {
    displayName: 'Mateo Silva',
    email: 'mateo.silva@dummy.dev',
    teamDisplayNames: ['Growth Loop', 'Launch Council'],
    primaryEmailVerified: false,
    isAnonymous: false,
    oauthProviders: [
      { providerId: 'github', accountId: 'mateo-silva-gh' },
      { providerId: 'google', accountId: 'mateo-silva-google' },
    ],
    createdAt: daysAgo(15, 9),
  },
  {
    displayName: 'Harper Lin',
    email: 'harper.lin@dummy.dev',
    teamDisplayNames: ['Growth Loop', 'Customer Advisory Board'],
    primaryEmailVerified: true,
    isAnonymous: false,
    oauthProviders: [
      { providerId: 'google', accountId: 'harper-lin-google' },
      { providerId: 'microsoft', accountId: 'harper-lin-msft' },
    ],
    createdAt: daysAgo(12, 13),
  },
  {
    displayName: 'Zara Malik',
    email: 'zara.malik@dummy.dev',
    profileImageUrl: 'https://avatar.vercel.sh/zara-malik?size=96',
    teamDisplayNames: ['Prototype Garage', EXPLORATORY_TEAM_DISPLAY_NAME],
    primaryEmailVerified: true,
    isAnonymous: false,
    oauthProviders: [
      { providerId: 'github', accountId: 'zara-malik-gh' },
      { providerId: 'spotify', accountId: 'zara-malik-spotify' },
    ],
    createdAt: daysAgo(9, 10),
  },
  {
    displayName: 'Luca Bennett',
    email: 'luca.bennett@dummy.dev',
    teamDisplayNames: ['Growth Loop', 'Ops'],
    primaryEmailVerified: false,
    isAnonymous: false,
    oauthProviders: [],
    createdAt: daysAgo(6, 16),
  },
  {
    displayName: 'Evelyn Brooks',
    email: 'evelyn.brooks@dummy.dev',
    profileImageUrl: 'https://avatar.vercel.sh/evelyn-brooks?size=96&background=15803d&color=fff',
    teamDisplayNames: ['Customer Advisory Board'],
    primaryEmailVerified: true,
    isAnonymous: false,
    oauthProviders: [],
    createdAt: daysAgo(4, 8),
  },
  {
    displayName: 'Theo Fischer',
    email: 'theo.fischer@dummy.dev',
    profileImageUrl: 'https://avatar.vercel.sh/theo-fischer?size=96&background=5b21b6&color=fff',
    teamDisplayNames: ['QA Collective', 'Prototype Garage'],
    primaryEmailVerified: true,
    isAnonymous: false,
    oauthProviders: [
      { providerId: 'microsoft', accountId: 'theo-fischer-msft' },
      { providerId: 'github', accountId: 'theo-fischer-gh' },
    ],
    createdAt: daysAgo(3, 11),
  },
  {
    email: 'naomi.patel@dummy.dev',
    teamDisplayNames: ['Prototype Garage', 'Design Systems Lab'],
    primaryEmailVerified: false,
    isAnonymous: false,
    oauthProviders: [],
    createdAt: daysAgo(1, 9),
  },
  {
    displayName: 'Kai Romero',
    email: 'kai.romero@dummy.dev',
    teamDisplayNames: ['Growth Loop'],
    primaryEmailVerified: true,
    isAnonymous: false,
    oauthProviders: [],
    createdAt: daysAgo(1, 15),
  },
];

const DUMMY_SEED_IDS = {
  subscriptions: {
    designSystemsGrowth: 'a296195f-c460-4cd6-b4c4-6cd359b4c643',
    prototypeStarterTrial: '5a255248-4d42-4d61-95f9-f53e97c3f2dd',
    mateoGrowthAnnual: 'c4acea49-302a-43b9-82a7-446b19e0e662',
    legacyEnterprise: '11664974-38ff-4356-8e39-2fa9105ed84f',
  },
  itemQuantityChanges: {
    designSeatsGrant: '44ca1801-0732-4273-ae14-4fd1c3999e24',
    opsAutomationCredit: 'a3e515dd-9332-4b15-b41a-90b9d6a37276',
    legacyReviewPass: 'b3c20e4f-608d-4c34-9c18-4a5c63780666',
  },
  oneTimePurchases: {
    ameliaSeatPack: '0b696a83-c54e-4a74-ae47-3ac5a4db49e6',
    launchCouncilUpfront: '10766081-37fd-410c-8b2e-1c3351e2d364',
  },
  invoices: {
    growthMonthly1: 'e1a2b3c4-d5e6-4f78-9a0b-1c2d3e4f5a60',
    growthMonthly2: 'f2b3c4d5-e6f7-4890-ab1c-2d3e4f5a6b71',
    growthMonthly3: 'a3c4d5e6-f7a8-4901-bc2d-3e4f5a6b7c82',
    growthMonthly4: 'b4d5e6f7-a8b9-4012-cd3e-4f5a6b7c8d93',
    growthMonthly5: 'c5e6f7a8-b9c0-4123-de4f-5a6b7c8d9ea4',
    starterCreation: 'd6f7a8b9-c0d1-4234-ef50-6a7b8c9d0fb5',
    legacyPaid1: 'e7a8b9c0-d1e2-4345-a061-7b8c9d0e1ac6',
    legacyPaid2: 'f8b9c0d1-e2f3-4456-b172-8c9d0e1f2bd7',
  },
  emails: {
    welcomeAmelia: 'af8cfd90-8912-4bf7-93a7-20ff2be54767',
    passkeyMilo: 'd534d777-5aa2-4014-a198-6484bbadcbf2',
    invitePriya: 'b7e31f58-cfd7-46cd-920f-d7616ad66bed',
    statusDigest: '2423e8d8-72cf-4355-a475-c2028e3ea958',
    templateFailure: 'faa33233-ba8d-4819-a89a-d442003cd589',
  },
} as const;

// ============= Seed Functions =============

async function seedDummyTeams(options: SeedDummyTeamsOptions): Promise<Map<string, string>> {
  const { prisma, tenancy } = options;

  const teamNameToId = new Map<string, string>();
  for (const team of teamSeeds) {
    const existingTeam = await prisma.team.findFirst({
      where: {
        tenancyId: tenancy.id,
        displayName: team.displayName,
      },
    });
    if (existingTeam) {
      teamNameToId.set(team.displayName, existingTeam.teamId);
      continue;
    }

    const createdTeam = await teamsCrudHandlers.adminCreate({
      tenancy,
      data: {
        display_name: team.displayName,
        profile_image_url: team.profileImageUrl ?? null,
      },
    });
    teamNameToId.set(team.displayName, createdTeam.id);
  }

  return teamNameToId;
}

type SeedOauthProvider = { providerId: string, accountId: string, email: string };

/**
 * Idempotently backfill OAuth provider rows for an existing seeded user.
 *
 * `adminCreate` already writes these on first insert, so this is a no-op for
 * newly-created users. For users that existed before the seed grew its OAuth
 * list, this appends the missing providers. Append-only by design: we never
 * delete providers present in the DB but absent from the seed list, because
 * that would cascade into AuthMethod rows and break unrelated tests.
 *
 * Dedupe key is `(configOAuthProviderId, providerAccountId)`, matching the
 * `@@unique([tenancyId, configOAuthProviderId, projectUserId, providerAccountId])`
 * constraint on ProjectUserOAuthAccount.
 *
 * Note: writes are sequential, not wrapped in `$transaction`, because the
 * shared `PrismaClientTransaction` type is a union whose transaction branch
 * doesn't expose `$transaction`. A partial failure could leak an orphan
 * AuthMethod row; that's acceptable for a seed.
 */
async function syncSeedUserOauthProviders(
  prisma: PrismaClientTransaction,
  tenancyId: string,
  projectUserId: string,
  providers: readonly SeedOauthProvider[],
): Promise<void> {
  if (providers.length === 0) return;

  const existing = await prisma.projectUserOAuthAccount.findMany({
    where: { tenancyId, projectUserId },
    select: { configOAuthProviderId: true, providerAccountId: true },
  });
  const existingKey = new Set(existing.map((a) => `${a.configOAuthProviderId}::${a.providerAccountId}`));

  for (const provider of providers) {
    if (existingKey.has(`${provider.providerId}::${provider.accountId}`)) continue;

    const authMethod = await prisma.authMethod.create({
      data: { tenancyId, projectUserId },
    });
    await prisma.projectUserOAuthAccount.create({
      data: {
        tenancyId,
        projectUserId,
        configOAuthProviderId: provider.providerId,
        providerAccountId: provider.accountId,
        email: provider.email,
        oauthAuthMethod: { create: { authMethodId: authMethod.id } },
        allowConnectedAccounts: true,
        allowSignIn: true,
      },
    });
  }
}

/**
 * Sample a random subset of OAuth providers for a bulk synthetic user.
 *
 * Distribution: ~50% get multiple accounts, ~30% get one, ~20% get none.
 * Consumes 1 + (roll < 0.5 ? 1 : 0) + n draws from `rand` per call; callers
 * relying on a deterministic PRNG stream must preserve this invariant.
 */
function pickBulkOauthProviders(params: {
  rand: () => number,
  available: readonly string[],
  email: string,
}): SeedOauthProvider[] {
  const { rand, available, email } = params;
  const roll = rand();
  let n: number;
  if (roll < 0.5) {
    n = 2 + Math.floor(rand() * (available.length - 1));
  } else if (roll < 0.8) {
    n = 1;
  } else {
    n = 0;
  }
  const pool = [...available];
  const picked: string[] = [];
  for (let i = 0; i < n && pool.length > 0; i++) {
    const idx = Math.floor(rand() * pool.length);
    picked.push(pool[idx]!);
    pool.splice(idx, 1);
  }
  return picked.map((providerId) => ({
    providerId,
    accountId: `${email}-${providerId}`,
    email,
  }));
}

async function seedDummyUsers(options: SeedDummyUsersOptions): Promise<Map<string, string>> {
  const { prisma, tenancy, teamNameToId } = options;

  const userEmailToId = new Map<string, string>();

  for (const user of userSeeds) {
    const existingUser = await prisma.projectUser.findFirst({
      where: {
        tenancyId: tenancy.id,
        contactChannels: {
          some: {
            type: 'EMAIL',
            value: user.email,
          },
        },
      },
      select: {
        projectUserId: true,
      },
    });

    let userId = existingUser?.projectUserId;
    if (!userId) {
      const createdUser = await usersCrudHandlers.adminCreate({
        tenancy,
        data: {
          display_name: user.displayName ?? null,
          primary_email: user.email,
          primary_email_auth_enabled: true,
          primary_email_verified: user.primaryEmailVerified,
          otp_auth_enabled: false,
          is_anonymous: user.isAnonymous,
          oauth_providers: user.oauthProviders.map((provider) => ({
            id: provider.providerId,
            account_id: provider.accountId,
            email: user.email,
          })),
          profile_image_url: user.profileImageUrl ?? null,
        },
      });
      userId = createdUser.id;
    }

    await syncSeedUserOauthProviders(
      prisma,
      tenancy.id,
      userId,
      user.oauthProviders.map((p) => ({
        providerId: p.providerId,
        accountId: p.accountId,
        email: user.email,
      })),
    );

    if (user.createdAt != null) {
      await prisma.projectUser.updateMany({
        where: { tenancyId: tenancy.id, projectUserId: userId },
        data: { createdAt: user.createdAt },
      });
    }

    userEmailToId.set(user.email, userId);

    for (const teamName of user.teamDisplayNames) {
      const teamId = teamNameToId.get(teamName) ?? throwErr(`Unknown dummy project team ${teamName}`);
      const existingMembership = await prisma.teamMember.findUnique({
        where: {
          tenancyId_projectUserId_teamId: {
            tenancyId: tenancy.id,
            projectUserId: userId,
            teamId,
          },
        },
      });
      if (existingMembership) continue;

      await teamMembershipsCrudHandlers.adminCreate({
        tenancy,
        team_id: teamId,
        user_id: userId,
        data: {},
      });
    }
  }

  // Generate additional bulk users for realistic chart data
  // Uses seeded PRNG for reproducibility — each day gets a varying number of sign-ups
  const bulkFirstNames = [
    'Alex', 'Jordan', 'Taylor', 'Morgan', 'Riley', 'Quinn', 'Avery', 'Dakota',
    'Casey', 'Hayden', 'Cameron', 'Rowan', 'Sage', 'Blake', 'Emery', 'Skyler',
    'Reese', 'Peyton', 'Eden', 'Finley', 'Kendall', 'Aubrey', 'Drew', 'Jesse',
    'Parker', 'Robin', 'Sydney', 'River', 'Harley', 'Milan',
  ];
  const bulkLastNames = [
    'Kim', 'Liu', 'Patel', 'Garcia', 'Brown', 'Davis', 'Wilson', 'Martinez',
    'Anderson', 'Thomas', 'Jackson', 'White', 'Harris', 'Clark', 'Lewis',
    'Robinson', 'Walker', 'Young', 'Allen', 'Scott', 'Adams', 'Nelson',
    'Hill', 'Moore', 'Hall', 'King', 'Wright', 'Green', 'Baker', 'Turner',
  ];
  const bulkOauthProviders = ['google', 'github', 'microsoft'];

  // Seeded LCG PRNG for reproducibility
  let bulkSeed = 42;
  const bulkRand = () => {
    bulkSeed = (bulkSeed * 1664525 + 1013904223) & 0x7fffffff;
    return bulkSeed / 0x7fffffff;
  };

  // Per-day sign-up counts (day 0 = 30 days ago, day 29 = yesterday)
  // Pattern: gradual growth with realistic variance and weekend dips
  const dailySignUpCounts = [
    1, 0, 2, 1, 3, 0, 1,   // week 1 (low, starting out)
    2, 3, 1, 2, 4, 1, 0,   // week 2 (picking up)
    3, 2, 4, 3, 2, 5, 1,   // week 3 (steady growth)
    4, 3, 5, 2, 6, 3, 2, 4, // week 4+ (peak recent activity)
  ];

  let bulkIndex = 0;
  for (let dayOffset = 0; dayOffset < dailySignUpCounts.length; dayOffset++) {
    const count = dailySignUpCounts[dayOffset];
    const dayBack = dailySignUpCounts.length - dayOffset;

    for (let j = 0; j < count; j++) {
      const fnIdx = Math.floor(bulkRand() * bulkFirstNames.length);
      const lnIdx = Math.floor(bulkRand() * bulkLastNames.length);
      const firstName = bulkFirstNames[fnIdx]!;
      const lastName = bulkLastNames[lnIdx]!;
      const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}.bulk${bulkIndex}@dummy.dev`;
      const displayName = `${firstName} ${lastName}`;
      const hour = 8 + Math.floor(bulkRand() * 12);
      const bulkCreatedAt = daysAgo(dayBack, hour);
      const oauthProvider = pickBulkOauthProviders({
        rand: bulkRand,
        available: bulkOauthProviders,
        email,
      });

      const existing = await prisma.projectUser.findFirst({
        where: {
          tenancyId: tenancy.id,
          contactChannels: { some: { type: 'EMAIL', value: email } },
        },
        select: { projectUserId: true },
      });

      let bulkUserId: string;
      if (!existing) {
        const created = await usersCrudHandlers.adminCreate({
          tenancy,
          data: {
            display_name: displayName,
            primary_email: email,
            primary_email_auth_enabled: true,
            primary_email_verified: bulkRand() > 0.3,
            otp_auth_enabled: false,
            is_anonymous: false,
            oauth_providers: oauthProvider.map((p) => ({
              id: p.providerId,
              account_id: p.accountId,
              email: p.email,
            })),
            profile_image_url: null,
          },
        });
        bulkUserId = created.id;
      } else {
        bulkUserId = existing.projectUserId;
      }
      await syncSeedUserOauthProviders(prisma, tenancy.id, bulkUserId, oauthProvider);
      await prisma.projectUser.updateMany({
        where: { tenancyId: tenancy.id, projectUserId: bulkUserId },
        data: { createdAt: bulkCreatedAt },
      });
      userEmailToId.set(email, bulkUserId);

      bulkIndex++;
    }
  }

  return userEmailToId;
}

function buildDummyPaymentsSetup(): PaymentsSetup {
  const monthlyInterval: DayInterval = [1, 'month'];
  const yearlyInterval: DayInterval = [1, 'year'];
  const twoWeekInterval: DayInterval = [2, 'week'];

  const paymentsProducts: Record<string, unknown> = {
    'starter': {
      displayName: 'Starter',
      productLineId: 'workspace',
      customerType: 'user',
      serverOnly: false,
      stackable: false,
      freeTrial: twoWeekInterval as any,
      prices: {
        monthly: {
          USD: '39',
          interval: monthlyInterval as any,
          serverOnly: false,
          freeTrial: twoWeekInterval as any,
        },
      },
      includedItems: {
        studio_seats: {
          quantity: 5,
          repeat: monthlyInterval as any,
          expires: 'when-repeated',
        },
        review_passes: {
          quantity: 50,
          repeat: monthlyInterval as any,
          expires: 'when-repeated',
        },
      },
    },
    'growth': {
      displayName: 'Growth',
      productLineId: 'workspace',
      customerType: 'user',
      serverOnly: false,
      stackable: false,
      prices: {
        monthly: {
          USD: '129',
          interval: monthlyInterval as any,
          serverOnly: false,
        },
        annual: {
          USD: '1290',
          interval: yearlyInterval as any,
          serverOnly: false,
        },
      },
      includedItems: {
        studio_seats: {
          quantity: 25,
          repeat: monthlyInterval as any,
          expires: 'when-repeated',
        },
        review_passes: {
          quantity: 250,
          repeat: monthlyInterval as any,
          expires: 'when-repeated',
        },
        automation_minutes: {
          quantity: 1000,
          repeat: monthlyInterval as any,
          expires: 'when-repeated',
        },
      },
    },
    'regression-addon': {
      displayName: 'Regression Add-on',
      productLineId: 'add_ons',
      customerType: 'user',
      serverOnly: false,
      stackable: true,
      prices: {
        monthly: {
          USD: '199',
          interval: monthlyInterval as any,
          serverOnly: false,
        },
      },
      includedItems: {
        snapshot_credits: {
          quantity: 500,
          repeat: monthlyInterval as any,
          expires: 'when-repeated',
        },
      },
      isAddOnTo: {
        'starter': true,
        'growth': true,
      },
    },
  };

  const paymentsBranchOverride = {
    productLines: {
      workspace: {
        displayName: 'Workspace Plans',
        customerType: 'team',
      },
      add_ons: {
        displayName: 'Add-ons',
        customerType: 'team',
      },
    },
    items: {
      studio_seats: {
        displayName: 'Studio Seats',
        customerType: 'user',
      },
      review_passes: {
        displayName: 'Reviewer Passes',
        customerType: 'user',
      },
      automation_minutes: {
        displayName: 'Automation Minutes',
        customerType: 'user',
      },
      snapshot_credits: {
        displayName: 'Snapshot Credits',
        customerType: 'user',
      },
    },
    products: paymentsProducts,
  };

  const paymentsEnvironmentOverride = {
    testMode: true,
  };

  return {
    paymentsProducts,
    paymentsBranchOverride,
    paymentsEnvironmentOverride,
  };
}

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

type SubscriptionSeed = {
  id: string,
  customerType: CustomerType,
  customerId: string,
  productId?: string,
  priceId?: string,
  product: Prisma.InputJsonValue,
  quantity: number,
  status: SubscriptionStatus,
  creationSource: PurchaseCreationSource,
  currentPeriodStart: Date,
  currentPeriodEnd: Date,
  cancelAtPeriodEnd: boolean,
  stripeSubscriptionId?: string | null,
  createdAt: Date,
};

type ItemQuantityChangeSeed = {
  id: string,
  customerType: CustomerType,
  customerId: string,
  itemId: string,
  quantity: number,
  description?: string,
  expiresAt?: Date | null,
  createdAt: Date,
};

type OneTimePurchaseSeed = {
  id: string,
  customerType: CustomerType,
  customerId: string,
  productId?: string,
  priceId?: string,
  product: Prisma.InputJsonValue,
  quantity: number,
  creationSource: PurchaseCreationSource,
  stripePaymentIntentId?: string | null,
  createdAt: Date,
};

async function seedDummyTransactions(options: TransactionsSeedOptions) {
  const {
    prisma,
    tenancyId,
    teamNameToId,
    userEmailToId,
    paymentsProducts,
  } = options;

  const resolveTeamId = (teamName: string) => teamNameToId.get(teamName) ?? throwErr(`Unknown dummy project team ${teamName}`);
  const resolveUserId = (email: string) => userEmailToId.get(email) ?? throwErr(`Unknown dummy project user ${email}`);
  const resolveProduct = (productId: string): Prisma.InputJsonValue => {
    const product = paymentsProducts[productId];
    if (!product) {
      throwErr(`Unknown payments product ${productId}`);
    }
    return cloneJson(product) as Prisma.InputJsonValue;
  };

  const subscriptionSeeds: SubscriptionSeed[] = [
    {
      id: DUMMY_SEED_IDS.subscriptions.designSystemsGrowth,
      customerType: CustomerType.TEAM,
      customerId: resolveTeamId('Design Systems Lab'),
      productId: 'growth',
      priceId: 'monthly',
      product: resolveProduct('growth'),
      quantity: 25,
      status: SubscriptionStatus.active,
      creationSource: PurchaseCreationSource.PURCHASE_PAGE,
      currentPeriodStart: new Date('2024-05-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2024-06-01T00:00:00.000Z'),
      cancelAtPeriodEnd: false,
      stripeSubscriptionId: 'sub_growth_designsystems',
      createdAt: new Date('2024-04-15T10:00:00.000Z'),
    },
    {
      id: DUMMY_SEED_IDS.subscriptions.prototypeStarterTrial,
      customerType: CustomerType.TEAM,
      customerId: resolveTeamId('Prototype Garage'),
      productId: 'starter',
      priceId: 'monthly',
      product: resolveProduct('starter'),
      quantity: 5,
      status: SubscriptionStatus.trialing,
      creationSource: PurchaseCreationSource.TEST_MODE,
      currentPeriodStart: new Date('2024-05-20T00:00:00.000Z'),
      currentPeriodEnd: new Date('2024-06-03T00:00:00.000Z'),
      cancelAtPeriodEnd: false,
      stripeSubscriptionId: 'sub_starter_prototype',
      createdAt: new Date('2024-05-19T08:00:00.000Z'),
    },
    {
      id: DUMMY_SEED_IDS.subscriptions.mateoGrowthAnnual,
      customerType: CustomerType.USER,
      customerId: resolveUserId('mateo.silva@dummy.dev'),
      productId: 'growth',
      priceId: 'annual',
      product: resolveProduct('growth'),
      quantity: 1,
      status: SubscriptionStatus.paused,
      creationSource: PurchaseCreationSource.API_GRANT,
      currentPeriodStart: new Date('2024-02-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2025-02-01T00:00:00.000Z'),
      cancelAtPeriodEnd: true,
      stripeSubscriptionId: null,
      createdAt: new Date('2024-02-01T00:00:00.000Z'),
    },
    {
      id: DUMMY_SEED_IDS.subscriptions.legacyEnterprise,
      customerType: CustomerType.CUSTOM,
      customerId: 'enterprise-alpha',
      productId: 'legacy-enterprise',
      priceId: undefined,
      product: cloneJson({
        displayName: 'Legacy Enterprise Pilot',
        productLineId: 'workspace',
        customerType: 'user',
        prices: 'include-by-default',
      }),
      quantity: 1,
      status: SubscriptionStatus.canceled,
      creationSource: PurchaseCreationSource.PURCHASE_PAGE,
      currentPeriodStart: new Date('2023-11-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2024-05-01T00:00:00.000Z'),
      cancelAtPeriodEnd: true,
      stripeSubscriptionId: 'sub_legacy_enterprise_alpha',
      createdAt: new Date('2023-11-01T00:00:00.000Z'),
    },
  ];

  for (const subscription of subscriptionSeeds) {
    await prisma.subscription.upsert({
      where: {
        tenancyId_id: {
          tenancyId,
          id: subscription.id,
        },
      },
      update: {
        customerId: subscription.customerId,
        customerType: subscription.customerType,
        productId: subscription.productId ?? null,
        priceId: subscription.priceId ?? null,
        product: subscription.product,
        quantity: subscription.quantity,
        status: subscription.status,
        currentPeriodEnd: subscription.currentPeriodEnd,
        currentPeriodStart: subscription.currentPeriodStart,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        creationSource: subscription.creationSource,
        stripeSubscriptionId: subscription.stripeSubscriptionId ?? null,
      },
      create: {
        tenancyId,
        id: subscription.id,
        customerId: subscription.customerId,
        customerType: subscription.customerType,
        productId: subscription.productId ?? null,
        priceId: subscription.priceId ?? null,
        product: subscription.product,
        quantity: subscription.quantity,
        status: subscription.status,
        currentPeriodEnd: subscription.currentPeriodEnd,
        currentPeriodStart: subscription.currentPeriodStart,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        creationSource: subscription.creationSource,
        stripeSubscriptionId: subscription.stripeSubscriptionId ?? null,
        createdAt: subscription.createdAt,
      },
    });
  }

  const itemQuantityChangeSeeds: ItemQuantityChangeSeed[] = [
    {
      id: DUMMY_SEED_IDS.itemQuantityChanges.designSeatsGrant,
      customerType: CustomerType.TEAM,
      customerId: resolveTeamId('Design Systems Lab'),
      itemId: 'studio_seats',
      quantity: 15,
      description: 'Bonus seats for cross-team design sprint',
      expiresAt: new Date('2024-07-15T00:00:00.000Z'),
      createdAt: new Date('2024-05-01T00:00:00.000Z'),
    },
    {
      id: DUMMY_SEED_IDS.itemQuantityChanges.opsAutomationCredit,
      customerType: CustomerType.TEAM,
      customerId: resolveTeamId('Ops'),
      itemId: 'automation_minutes',
      quantity: 1200,
      description: 'Reliability incident credit',
      expiresAt: new Date('2024-08-01T00:00:00.000Z'),
      createdAt: new Date('2024-05-10T09:30:00.000Z'),
    },
    {
      id: DUMMY_SEED_IDS.itemQuantityChanges.legacyReviewPass,
      customerType: CustomerType.CUSTOM,
      customerId: 'visual-review-partner',
      itemId: 'legacy_review_pass',
      quantity: 25,
      description: 'Legacy migration allowance',
      expiresAt: new Date('2024-09-15T00:00:00.000Z'),
      createdAt: new Date('2024-04-18T00:00:00.000Z'),
    },
  ];

  for (const quantityChange of itemQuantityChangeSeeds) {
    await prisma.itemQuantityChange.upsert({
      where: {
        tenancyId_id: {
          tenancyId,
          id: quantityChange.id,
        },
      },
      update: {
        customerId: quantityChange.customerId,
        customerType: quantityChange.customerType,
        itemId: quantityChange.itemId,
        quantity: quantityChange.quantity,
        description: quantityChange.description ?? null,
        expiresAt: quantityChange.expiresAt ?? null,
      },
      create: {
        tenancyId,
        id: quantityChange.id,
        customerId: quantityChange.customerId,
        customerType: quantityChange.customerType,
        itemId: quantityChange.itemId,
        quantity: quantityChange.quantity,
        description: quantityChange.description ?? null,
        expiresAt: quantityChange.expiresAt ?? null,
        createdAt: quantityChange.createdAt,
      },
    });
  }

  const oneTimePurchaseSeeds: OneTimePurchaseSeed[] = [
    {
      id: DUMMY_SEED_IDS.oneTimePurchases.ameliaSeatPack,
      customerType: CustomerType.USER,
      customerId: resolveUserId('amelia.chen@dummy.dev'),
      productId: 'starter',
      priceId: 'monthly',
      product: resolveProduct('starter'),
      quantity: 2,
      creationSource: PurchaseCreationSource.TEST_MODE,
      stripePaymentIntentId: null,
      createdAt: new Date('2024-05-25T15:00:00.000Z'),
    },
    {
      id: DUMMY_SEED_IDS.oneTimePurchases.launchCouncilUpfront,
      customerType: CustomerType.TEAM,
      customerId: resolveTeamId('Launch Council'),
      productId: 'growth',
      priceId: 'annual',
      product: resolveProduct('growth'),
      quantity: 1,
      creationSource: PurchaseCreationSource.PURCHASE_PAGE,
      stripePaymentIntentId: 'pi_launch_council_growth',
      createdAt: new Date('2024-03-12T00:00:00.000Z'),
    },
  ];

  for (const purchase of oneTimePurchaseSeeds) {
    await prisma.oneTimePurchase.upsert({
      where: {
        tenancyId_id: {
          tenancyId,
          id: purchase.id,
        },
      },
      update: {
        customerId: purchase.customerId,
        customerType: purchase.customerType,
        productId: purchase.productId ?? null,
        priceId: purchase.priceId ?? null,
        product: purchase.product,
        quantity: purchase.quantity,
        creationSource: purchase.creationSource,
        stripePaymentIntentId: purchase.stripePaymentIntentId ?? null,
      },
      create: {
        tenancyId,
        id: purchase.id,
        customerId: purchase.customerId,
        customerType: purchase.customerType,
        productId: purchase.productId ?? null,
        priceId: purchase.priceId ?? null,
        product: purchase.product,
        quantity: purchase.quantity,
        creationSource: purchase.creationSource,
        stripePaymentIntentId: purchase.stripePaymentIntentId ?? null,
        createdAt: purchase.createdAt,
      },
    });
  }

  type InvoiceSeed = {
    id: string,
    stripeSubscriptionId: string,
    stripeInvoiceId: string,
    isSubscriptionCreationInvoice: boolean,
    status: string,
    amountTotal: number,
    createdAt: Date,
  };

  const invoiceSeeds: InvoiceSeed[] = [
    {
      id: DUMMY_SEED_IDS.invoices.growthMonthly1,
      stripeSubscriptionId: 'sub_growth_designsystems',
      stripeInvoiceId: 'in_growth_ds_001',
      isSubscriptionCreationInvoice: true,
      status: 'paid',
      amountTotal: 12900,
      createdAt: daysAgo(25, 10),
    },
    {
      id: DUMMY_SEED_IDS.invoices.growthMonthly2,
      stripeSubscriptionId: 'sub_growth_designsystems',
      stripeInvoiceId: 'in_growth_ds_002',
      isSubscriptionCreationInvoice: false,
      status: 'paid',
      amountTotal: 12900,
      createdAt: daysAgo(18, 10),
    },
    {
      id: DUMMY_SEED_IDS.invoices.growthMonthly3,
      stripeSubscriptionId: 'sub_growth_designsystems',
      stripeInvoiceId: 'in_growth_ds_003',
      isSubscriptionCreationInvoice: false,
      status: 'paid',
      amountTotal: 12900,
      createdAt: daysAgo(11, 10),
    },
    {
      id: DUMMY_SEED_IDS.invoices.growthMonthly4,
      stripeSubscriptionId: 'sub_growth_designsystems',
      stripeInvoiceId: 'in_growth_ds_004',
      isSubscriptionCreationInvoice: false,
      status: 'paid',
      amountTotal: 12900,
      createdAt: daysAgo(4, 10),
    },
    {
      id: DUMMY_SEED_IDS.invoices.growthMonthly5,
      stripeSubscriptionId: 'sub_growth_designsystems',
      stripeInvoiceId: 'in_growth_ds_005',
      isSubscriptionCreationInvoice: false,
      status: 'succeeded',
      amountTotal: 15900,
      createdAt: daysAgo(1, 14),
    },
    {
      id: DUMMY_SEED_IDS.invoices.starterCreation,
      stripeSubscriptionId: 'sub_starter_prototype',
      stripeInvoiceId: 'in_starter_proto_001',
      isSubscriptionCreationInvoice: true,
      status: 'paid',
      amountTotal: 0,
      createdAt: daysAgo(20, 8),
    },
    {
      id: DUMMY_SEED_IDS.invoices.legacyPaid1,
      stripeSubscriptionId: 'sub_legacy_enterprise_alpha',
      stripeInvoiceId: 'in_legacy_ent_001',
      isSubscriptionCreationInvoice: true,
      status: 'paid',
      amountTotal: 49900,
      createdAt: daysAgo(28, 9),
    },
    {
      id: DUMMY_SEED_IDS.invoices.legacyPaid2,
      stripeSubscriptionId: 'sub_legacy_enterprise_alpha',
      stripeInvoiceId: 'in_legacy_ent_002',
      isSubscriptionCreationInvoice: false,
      status: 'paid',
      amountTotal: 49900,
      createdAt: daysAgo(14, 9),
    },
  ];

  for (const invoice of invoiceSeeds) {
    await prisma.subscriptionInvoice.upsert({
      where: {
        tenancyId_id: {
          tenancyId,
          id: invoice.id,
        },
      },
      update: {
        status: invoice.status,
        amountTotal: invoice.amountTotal,
      },
      create: {
        tenancyId,
        id: invoice.id,
        stripeSubscriptionId: invoice.stripeSubscriptionId,
        stripeInvoiceId: invoice.stripeInvoiceId,
        isSubscriptionCreationInvoice: invoice.isSubscriptionCreationInvoice,
        status: invoice.status,
        amountTotal: invoice.amountTotal,
        createdAt: invoice.createdAt,
      },
    });
  }
}

async function seedDummyEmails(options: EmailSeedOptions) {
  const { prisma, tenancyId, userEmailToId } = options;
  const resolveOptionalUserId = (email?: string) => {
    if (!email) return null;
    const userId = userEmailToId.get(email);
    if (!userId) {
      throwErr(`Unknown dummy project user ${email}`);
    }
    return userId;
  };

  const emailSeeds: EmailOutboxSeed[] = [
    {
      id: DUMMY_SEED_IDS.emails.welcomeAmelia,
      subject: 'Welcome to Dummy Project',
      html: '<p>Hi Amelia,<br/>Welcome to Dummy Project.</p>',
      text: 'Hi Amelia,\nWelcome to Dummy Project.',
      createdAt: new Date('2024-05-01T13:00:00.000Z'),
      userEmail: 'amelia.chen@dummy.dev',
    },
    {
      id: DUMMY_SEED_IDS.emails.passkeyMilo,
      subject: 'Your passkey sign-in link',
      html: '<p>Complete your sign-in within <strong>10 minutes</strong>.</p>',
      text: 'Complete your sign-in within 10 minutes.',
      createdAt: new Date('2024-05-02T10:00:00.000Z'),
      userEmail: 'milo.adeyemi@dummy.dev',
    },
    {
      id: DUMMY_SEED_IDS.emails.invitePriya,
      subject: 'Dashboard invite for Ops',
      html: '<p>Welcome to the dashboard!</p>',
      hasError: true,
      createdAt: new Date('2024-05-04T18:30:00.000Z'),
      userEmail: 'priya.narang@dummy.dev',
    },
    {
      id: DUMMY_SEED_IDS.emails.statusDigest,
      subject: 'Nightly status digest',
      text: 'All services operational. 3 warnings acknowledged.',
      createdAt: new Date('2024-05-06T07:45:00.000Z'),
    },
    {
      id: DUMMY_SEED_IDS.emails.templateFailure,
      subject: 'Template rendering failed - Review',
      html: '<p>Rendering failed due to <code>undefined</code> data from billing.</p>',
      hasError: true,
      createdAt: new Date('2024-05-08T12:05:00.000Z'),
    },
  ];

  for (const email of emailSeeds) {
    const userId = resolveOptionalUserId(email.userEmail);
    const recipient = userId
      ? { type: 'user-primary-email', userId }
      : { type: 'custom-emails', emails: ['unknown@dummy.dev'] };

    await globalPrismaClient.emailOutbox.upsert({
      where: {
        tenancyId_id: {
          tenancyId,
          id: email.id,
        },
      },
      update: {},
      create: {
        tenancyId,
        id: email.id,
        tsxSource: '',
        isHighPriority: false,
        to: recipient,
        extraRenderVariables: {},
        shouldSkipDeliverabilityCheck: false,
        createdWith: EmailOutboxCreatedWith.PROGRAMMATIC_CALL,
        scheduledAt: email.createdAt,
        renderedByWorkerId: email.id,
        startedRenderingAt: email.createdAt,
        finishedRenderingAt: email.createdAt,
        renderedSubject: email.subject,
        renderedHtml: email.html ?? null,
        renderedText: email.text ?? null,
        startedSendingAt: email.createdAt,
        finishedSendingAt: email.createdAt,
        canHaveDeliveryInfo: false,
        sendServerErrorExternalMessage: email.hasError ? 'Delivery failed' : null,
        sendServerErrorExternalDetails: email.hasError ? {} : Prisma.DbNull,
        sendServerErrorInternalMessage: email.hasError ? "Delivery failed. This is the internal error message." : null,
        sendServerErrorInternalDetails: email.hasError ? { internalError: "No internal error details." } : Prisma.DbNull,
        createdAt: email.createdAt,
      },
    });
  }
}

const sessionActivityLocations = [
  { countryCode: 'US', regionCode: 'CA', cityName: 'San Francisco', latitude: 37.7749, longitude: -122.4194, tzIdentifier: 'America/Los_Angeles' },
  { countryCode: 'US', regionCode: 'NY', cityName: 'New York', latitude: 40.7128, longitude: -74.0060, tzIdentifier: 'America/New_York' },
  { countryCode: 'GB', regionCode: 'ENG', cityName: 'London', latitude: 51.5074, longitude: -0.1278, tzIdentifier: 'Europe/London' },
  { countryCode: 'DE', regionCode: 'BE', cityName: 'Berlin', latitude: 52.5200, longitude: 13.4050, tzIdentifier: 'Europe/Berlin' },
  { countryCode: 'JP', regionCode: '13', cityName: 'Tokyo', latitude: 35.6762, longitude: 139.6503, tzIdentifier: 'Asia/Tokyo' },
  { countryCode: 'AU', regionCode: 'NSW', cityName: 'Sydney', latitude: -33.8688, longitude: 151.2093, tzIdentifier: 'Australia/Sydney' },
  { countryCode: 'IN', regionCode: 'KA', cityName: 'Bangalore', latitude: 12.9716, longitude: 77.5946, tzIdentifier: 'Asia/Kolkata' },
  { countryCode: 'BR', regionCode: 'SP', cityName: 'São Paulo', latitude: -23.5505, longitude: -46.6333, tzIdentifier: 'America/Sao_Paulo' },
  { countryCode: 'CA', regionCode: 'ON', cityName: 'Toronto', latitude: 43.6532, longitude: -79.3832, tzIdentifier: 'America/Toronto' },
  { countryCode: 'FR', regionCode: 'IDF', cityName: 'Paris', latitude: 48.8566, longitude: 2.3522, tzIdentifier: 'Europe/Paris' },
  { countryCode: 'SG', regionCode: 'SG', cityName: 'Singapore', latitude: 1.3521, longitude: 103.8198, tzIdentifier: 'Asia/Singapore' },
  { countryCode: 'NL', regionCode: 'NH', cityName: 'Amsterdam', latitude: 52.3676, longitude: 4.9041, tzIdentifier: 'Europe/Amsterdam' },
  { countryCode: 'SE', regionCode: 'AB', cityName: 'Stockholm', latitude: 59.3293, longitude: 18.0686, tzIdentifier: 'Europe/Stockholm' },
  { countryCode: 'ES', regionCode: 'MD', cityName: 'Madrid', latitude: 40.4168, longitude: -3.7038, tzIdentifier: 'Europe/Madrid' },
  { countryCode: 'IT', regionCode: 'RM', cityName: 'Rome', latitude: 41.9028, longitude: 12.4964, tzIdentifier: 'Europe/Rome' },
  { countryCode: 'MX', regionCode: 'CMX', cityName: 'Mexico City', latitude: 19.4326, longitude: -99.1332, tzIdentifier: 'America/Mexico_City' },
  { countryCode: 'KR', regionCode: '11', cityName: 'Seoul', latitude: 37.5665, longitude: 126.9780, tzIdentifier: 'Asia/Seoul' },
  { countryCode: 'ZA', regionCode: 'GT', cityName: 'Johannesburg', latitude: -26.2041, longitude: 28.0473, tzIdentifier: 'Africa/Johannesburg' },
  { countryCode: 'AE', regionCode: 'DU', cityName: 'Dubai', latitude: 25.2048, longitude: 55.2708, tzIdentifier: 'Asia/Dubai' },
  { countryCode: 'CH', regionCode: 'ZH', cityName: 'Zurich', latitude: 47.3769, longitude: 8.5417, tzIdentifier: 'Europe/Zurich' },
];

// ── Bulk activity seed fixtures ─────────────────────────────────────────────

const BULK_ACTIVITY_REGIONS: BulkActivityRegion[] = [
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

const BULK_ACTIVITY_REGION_WEIGHT_TOTAL = BULK_ACTIVITY_REGIONS.reduce((sum, r) => sum + r.weight, 0);

function pickBulkActivityRegion(rand: () => number): BulkActivityRegion {
  const roll = rand() * BULK_ACTIVITY_REGION_WEIGHT_TOTAL;
  let acc = 0;
  for (const r of BULK_ACTIVITY_REGIONS) {
    acc += r.weight;
    if (roll < acc) return r;
  }
  return BULK_ACTIVITY_REGIONS[BULK_ACTIVITY_REGIONS.length - 1]!;
}

const BULK_FIRST_NAMES = [
  'Alex', 'Jordan', 'Taylor', 'Morgan', 'Riley', 'Quinn', 'Avery', 'Dakota',
  'Casey', 'Hayden', 'Cameron', 'Rowan', 'Sage', 'Blake', 'Emery', 'Skyler',
  'Reese', 'Peyton', 'Eden', 'Finley', 'Kendall', 'Aubrey', 'Drew', 'Jesse',
  'Parker', 'Robin', 'Sydney', 'River', 'Harley', 'Milan', 'Aarav', 'Yuki',
  'Mateo', 'Nia', 'Omar', 'Priya', 'Kai', 'Luca', 'Zara', 'Ines', 'Noa',
];
const BULK_LAST_NAMES = [
  'Kim', 'Liu', 'Patel', 'Garcia', 'Brown', 'Davis', 'Wilson', 'Martinez',
  'Anderson', 'Thomas', 'Jackson', 'White', 'Harris', 'Clark', 'Lewis',
  'Robinson', 'Walker', 'Young', 'Allen', 'Scott', 'Adams', 'Nelson', 'Hill',
  'Moore', 'Hall', 'King', 'Wright', 'Green', 'Baker', 'Turner', 'Okafor',
  'Suzuki', 'Schneider', 'Dubois', 'Rossi', 'Nakamura', 'Silva', 'Ivanov',
];
const BULK_REFERRERS = [
  { url: 'https://www.google.com/', weight: 32 },
  { url: 'https://github.com/', weight: 18 },
  { url: 'https://twitter.com/', weight: 12 },
  { url: 'https://www.producthunt.com/', weight: 8 },
  { url: '', weight: 20 },  // direct traffic
  { url: 'https://news.ycombinator.com/', weight: 6 },
  { url: 'https://www.reddit.com/', weight: 4 },
];
const BULK_REFERRER_WEIGHT_TOTAL = BULK_REFERRERS.reduce((sum, r) => sum + r.weight, 0);

function pickBulkReferrer(rand: () => number): string {
  const roll = rand() * BULK_REFERRER_WEIGHT_TOTAL;
  let acc = 0;
  for (const r of BULK_REFERRERS) {
    acc += r.weight;
    if (roll < acc) return r.url;
  }
  return '';
}

const BULK_PAGE_PATHS = [
  '/', '/pricing', '/docs', '/docs/getting-started', '/docs/api-reference',
  '/blog', '/blog/announcing-v2', '/about', '/contact', '/changelog',
  '/dashboard', '/settings', '/settings/profile', '/settings/billing',
  '/integrations', '/features', '/enterprise',
];

function bulkFakeIp(prefix: string, rand: () => number): string {
  const c = Math.floor(rand() * 256);
  const d = Math.floor(rand() * 254) + 1;
  return `${prefix}.${c}.${d}`;
}

function bulkRandomTimestampOnDay(now: Date, daysAgo: number, rand: () => number): Date {
  const ts = new Date(now);
  ts.setUTCDate(ts.getUTCDate() - daysAgo);
  const hour = 8 + Math.floor(rand() * 14);
  ts.setUTCHours(hour, Math.floor(rand() * 60), Math.floor(rand() * 60), Math.floor(rand() * 1000));
  return ts;
}

function distributeBulkSignups(count: number, days: number, rand: () => number, now: Date): number[] {
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

async function seedDummySessionActivityEvents(options: SessionActivityEventSeedOptions) {
  const { tenancyId, projectId, userEmailToId } = options;

  // Anchor on midnight today so the seeded window is stable across re-runs
  // within the same day. Across days the window legitimately shifts forward.
  const todayUtc = new Date();
  todayUtc.setUTCHours(0, 0, 0, 0);
  const twoMonthsAgo = new Date(todayUtc);
  twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
  const windowMs = todayUtc.getTime() - twoMonthsAgo.getTime();

  const userIds = Array.from(userEmailToId.values());
  const systemEventTypeIds = ['$session-activity', '$user-activity', '$project-activity', '$project'];

  console.log(`Seeding session activity events for ${userIds.length} users...`);

  const eventIpInfos: Prisma.EventIpInfoCreateManyInput[] = [];
  const events: Prisma.EventCreateManyInput[] = [];
  const clickhouseRows: Array<Record<string, unknown>> = [];

  const clickhouseUrl = getEnvVariable('STACK_CLICKHOUSE_URL', '');
  const shouldSeedClickhouse = clickhouseUrl !== '';
  const clickhouseClient = shouldSeedClickhouse ? getClickhouseAdminClient() : null;

  for (const userId of userIds) {
    // Per-user seeded PRNG so event count, timestamps, and locations are
    // deterministic across re-runs. Deterministic IDs mean seeded rows can be
    // replaced in bulk while staying idempotent across runs.
    const userRand = deterministicPrng(seedFromString(`session-events:${tenancyId}:${userId}`));
    const eventCount = 15 + Math.floor(userRand() * 11); // 15-25 events

    for (let i = 0; i < eventCount; i++) {
      const randomTime = new Date(twoMonthsAgo.getTime() + userRand() * windowMs);
      const location = sessionActivityLocations[Math.floor(userRand() * sessionActivityLocations.length)]!;
      const sessionId = `session-${userId.substring(0, 8)}-${i.toString().padStart(3, '0')}`;
      const ipAddress = `${10 + Math.floor(userRand() * 200)}.${Math.floor(userRand() * 256)}.${Math.floor(userRand() * 256)}.${Math.floor(userRand() * 256)}`;
      const refreshTokenId = deterministicUuid(`session-events-refresh-token:${tenancyId}:${userId}:${i}`);

      const ipInfoId = deterministicUuid(`event-ip-info:${tenancyId}:${userId}:${i}`);
      const eventId = deterministicUuid(`event:${tenancyId}:${userId}:${i}`);

      eventIpInfos.push({
        id: ipInfoId,
        ip: ipAddress,
        countryCode: location.countryCode,
        regionCode: location.regionCode,
        cityName: location.cityName,
        latitude: location.latitude,
        longitude: location.longitude,
        tzIdentifier: location.tzIdentifier,
        createdAt: randomTime,
        updatedAt: randomTime,
      });

      events.push({
        id: eventId,
        systemEventTypeIds,
        data: {
          projectId,
          branchId: DEFAULT_BRANCH_ID,
          userId,
          sessionId,
          isAnonymous: false,
        },
        isEndUserIpInfoGuessTrusted: true,
        endUserIpInfoGuessId: ipInfoId,
        isWide: false,
        eventStartedAt: randomTime,
        eventEndedAt: randomTime,
        createdAt: randomTime,
        updatedAt: randomTime,
      });

      if (clickhouseClient) {
        clickhouseRows.push({
          event_type: '$token-refresh',
          event_at: randomTime,
          data: {
            refresh_token_id: refreshTokenId,
            is_anonymous: false,
            ip_info: {
              ip: ipAddress,
              is_trusted: true,
              country_code: location.countryCode,
              region_code: location.regionCode,
              city_name: location.cityName,
              latitude: location.latitude,
              longitude: location.longitude,
              tz_identifier: location.tzIdentifier,
            },
          },
          project_id: projectId,
          branch_id: DEFAULT_BRANCH_ID,
          user_id: userId,
          team_id: null,
          refresh_token_id: refreshTokenId,
          session_replay_id: null,
          session_replay_segment_id: null,
        });
      }
    }
  }

  await globalPrismaClient.$transaction(async (tx) => {
    const eventIds = events.map((event) => event.id ?? throwErr('Seeded event row is missing id'));
    const ipInfoIds = eventIpInfos.map((info) => info.id ?? throwErr('Seeded event IP info row is missing id'));

    await tx.event.deleteMany({
      where: {
        id: { in: eventIds },
      },
    });
    await tx.eventIpInfo.deleteMany({
      where: {
        id: { in: ipInfoIds },
      },
    });

    await tx.eventIpInfo.createMany({
      data: eventIpInfos,
    });
    await tx.event.createMany({
      data: events,
    });
  });

  if (clickhouseClient && clickhouseRows.length > 0) {
    const BATCH_SIZE = 500;
    for (let i = 0; i < clickhouseRows.length; i += BATCH_SIZE) {
      await clickhouseClient.insert({
        table: 'analytics_internal.events',
        values: clickhouseRows.slice(i, i + BATCH_SIZE),
        format: 'JSONEachRow',
        clickhouse_settings: {
          date_time_input_format: 'best_effort',
          async_insert: 1,
        },
      });
    }
  }

  console.log(`Finished seeding session activity events (${events.length} events)`);
}

/**
 * Seeds the dummy project with a bulk batch of fake user sign-ups and
 * realistic activity data spread across recent history and various
 * geographic regions. Populates:
 *
 *   1. ProjectUser rows with back-dated signedUpAt/createdAt
 *   2. $token-refresh events in ClickHouse with geolocated ip_info
 *   3. $page-view events in ClickHouse for daily visitors/page views/referrers
 *   4. $click events in ClickHouse for the clicks chart
 */
async function seedBulkSignupsAndActivity(options: {
  tenancy: Tenancy,
  prisma: PrismaClientTransaction,
  count?: number,
  days?: number,
}) {
  const count = options.count ?? 500;
  const days = options.days ?? 60;
  const now = new Date();
  const rand = deterministicPrng(0xC0FFEE);
  const { tenancy, prisma } = options;
  const clickhouse = getClickhouseAdminClient();

  console.log(`[seed-activity] Target: ${count} users across ${days} days in project "${tenancy.project.id}" branch "${tenancy.branchId}"`);

  const dayOffsets = distributeBulkSignups(count, days, rand, now);
  const clickhouseRows: Array<Record<string, unknown>> = [];

  let created = 0;
  let updated = 0;

  const seedUsers: Array<{
    index: number,
    email: string,
    displayName: string,
    signedUpAt: Date,
    signupDaysAgo: number,
    region: BulkActivityRegion,
    primaryEmailVerified: boolean,
    projectUserId: string,
  }> = [];
  for (let i = 0; i < count; i++) {
    const firstName = BULK_FIRST_NAMES[Math.floor(rand() * BULK_FIRST_NAMES.length)]!;
    const lastName = BULK_LAST_NAMES[Math.floor(rand() * BULK_LAST_NAMES.length)]!;
    const displayName = `${firstName} ${lastName}`;
    const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}.signupseed${i}@dummy.dev`;
    const signedUpAt = bulkRandomTimestampOnDay(now, dayOffsets[i]!, rand);
    const region = pickBulkActivityRegion(rand);
    const primaryEmailVerified = rand() > 0.25;
    seedUsers.push({
      index: i,
      email,
      displayName,
      signedUpAt,
      signupDaysAgo: dayOffsets[i]!,
      region,
      primaryEmailVerified,
      projectUserId: deterministicUuid(`bulk-signup-user:${tenancy.id}:${email}`),
    });
  }

  const existingContactChannels = await prisma.contactChannel.findMany({
    where: {
      tenancyId: tenancy.id,
      type: 'EMAIL',
      isPrimary: 'TRUE',
      usedForAuth: 'TRUE',
      value: { in: seedUsers.map((seedUser) => seedUser.email) },
    },
    select: {
      value: true,
      projectUserId: true,
    },
  });

  const existingUserIdByEmail = new Map<string, string>();
  for (const existingContactChannel of existingContactChannels) {
    const existingUserId = existingUserIdByEmail.get(existingContactChannel.value);
    if (existingUserId != null && existingUserId !== existingContactChannel.projectUserId) {
      throwErr(`Expected one authenticated user per seed email (${existingContactChannel.value}), found multiple project users`);
    }
    existingUserIdByEmail.set(existingContactChannel.value, existingContactChannel.projectUserId);
  }

  const projectUsersToCreate: Prisma.ProjectUserCreateManyInput[] = [];
  const contactChannelsToCreate: Prisma.ContactChannelCreateManyInput[] = [];
  const userActivity: Array<{ userId: string, signupDaysAgo: number, region: BulkActivityRegion, signedUpAt: Date }> = [];

  for (const seedUser of seedUsers) {
    const userId = existingUserIdByEmail.get(seedUser.email) ?? seedUser.projectUserId;
    const existingUserId = existingUserIdByEmail.get(seedUser.email);
    if (existingUserId == null) {
      created++;
      projectUsersToCreate.push({
        tenancyId: tenancy.id,
        projectUserId: userId,
        mirroredProjectId: tenancy.project.id,
        mirroredBranchId: tenancy.branchId,
        displayName: seedUser.displayName,
        isAnonymous: false,
        createdAt: seedUser.signedUpAt,
        lastActiveAt: seedUser.signedUpAt,
        signedUpAt: seedUser.signedUpAt,
        signUpRiskScoreBot: 0,
        signUpRiskScoreFreeTrialAbuse: 0,
      });
      contactChannelsToCreate.push({
        tenancyId: tenancy.id,
        projectUserId: userId,
        type: 'EMAIL',
        isPrimary: 'TRUE',
        usedForAuth: 'TRUE',
        isVerified: seedUser.primaryEmailVerified,
        value: seedUser.email,
        createdAt: seedUser.signedUpAt,
        updatedAt: seedUser.signedUpAt,
      });
    } else {
      updated++;
    }

    userActivity.push({
      userId,
      signupDaysAgo: seedUser.signupDaysAgo,
      region: seedUser.region,
      signedUpAt: seedUser.signedUpAt,
    });

    const ipInfoForUser = {
      ip: bulkFakeIp(seedUser.region.ipPrefix, rand),
      is_trusted: true,
      country_code: seedUser.region.country,
      region_code: seedUser.region.region,
      city_name: seedUser.region.city,
      latitude: seedUser.region.lat,
      longitude: seedUser.region.lon,
      tz_identifier: seedUser.region.tz,
    };

    clickhouseRows.push({
      event_type: '$token-refresh',
      event_at: formatClickhouseTimestamp(seedUser.signedUpAt),
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

    if ((seedUser.index + 1) % 100 === 0) {
      console.log(`[seed-activity] ${seedUser.index + 1}/${count} users processed (${created} new, ${updated} updated)`);
    }
  }

  if (projectUsersToCreate.length > 0) {
    await prisma.projectUser.createMany({
      data: projectUsersToCreate,
      skipDuplicates: true,
    });
  }
  if (contactChannelsToCreate.length > 0) {
    await prisma.contactChannel.createMany({
      data: contactChannelsToCreate,
      skipDuplicates: true,
    });
  }

  if (userActivity.length > 0) {
    const seededTimestampRows = userActivity.map((activity) => Prisma.sql`(${activity.userId}::uuid, ${activity.signedUpAt}::timestamptz)`);
    await prisma.$executeRaw`
      UPDATE "ProjectUser" AS pu
      SET "createdAt" = seeded.signed_up_at,
          "signedUpAt" = seeded.signed_up_at
      FROM (VALUES ${Prisma.join(seededTimestampRows)}) AS seeded(project_user_id, signed_up_at)
      WHERE pu."tenancyId" = ${tenancy.id}
        AND pu."projectUserId" = seeded.project_user_id
    `;
  }

  console.log(`[seed-activity] Generating multi-day activity events for ${userActivity.length} users...`);

  for (const { userId, signupDaysAgo, region } of userActivity) {
    if (signupDaysAgo === 0) continue;
    const isReturning = rand() < 0.7;
    if (!isReturning) continue;

    const returnVisits = 2 + Math.floor(rand() * 7);
    const ipInfo = {
      ip: bulkFakeIp(region.ipPrefix, rand),
      is_trusted: true,
      country_code: region.country,
      region_code: region.region,
      city_name: region.city,
      latitude: region.lat,
      longitude: region.lon,
      tz_identifier: region.tz,
    };

    for (let v = 0; v < returnVisits; v++) {
      const visitDaysAgo = Math.floor(rand() * signupDaysAgo);
      const visitTime = bulkRandomTimestampOnDay(now, visitDaysAgo, rand);

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

      const pageViewCount = 1 + Math.floor(rand() * 4);
      for (let p = 0; p < pageViewCount; p++) {
        const pvOffset = Math.floor(rand() * 3600) * 1000;
        const pvTime = new Date(visitTime.getTime() + pvOffset);
        clickhouseRows.push({
          event_type: '$page-view',
          event_at: formatClickhouseTimestamp(pvTime),
          data: {
            path: BULK_PAGE_PATHS[Math.floor(rand() * BULK_PAGE_PATHS.length)],
            referrer: p === 0 ? pickBulkReferrer(rand) : '',
            is_anonymous: false,
          },
          project_id: tenancy.project.id,
          branch_id: tenancy.branchId,
          user_id: userId,
          team_id: null,
        });
      }

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

/**
 * Creates a new project and fills it with dummy data (users, teams, payments, emails, analytics events).
 * Used by both the seed script and the preview project creation endpoint.
 */
export async function seedDummyProject(options: SeedDummyProjectOptions): Promise<string> {
  const projectId = options.projectId ?? generateUuid();

  const baseProjectData = {
    display_name: 'Demo Project',
    is_production_mode: false,
    config: {
      allow_localhost: true,
      sign_up_enabled: true,
      credential_enabled: true,
      magic_link_enabled: true,
      passkey_enabled: true,
      client_team_creation_enabled: true,
      client_user_deletion_enabled: true,
      allow_user_api_keys: true,
      allow_team_api_keys: true,
      create_team_on_sign_up: false,
      email_theme: DEFAULT_EMAIL_THEME_ID,
      email_config: {
        type: 'shared',
      },
      oauth_providers: options.oauthProviderIds.map((id) => ({
        id: id as any,
        type: 'shared',
      })),
      domains: [],
    },
  } satisfies ProjectsCrud["Admin"]["Update"];
  const projectCreateData: AdminUserProjectsCrud["Admin"]["Create"] = {
    ...baseProjectData,
    owner_team_id: options.ownerTeamId,
  };

  const existingProject = await getProject(projectId);
  if (!existingProject) {
    await createOrUpdateProjectWithLegacyConfig({
      type: 'create',
      projectId,
      data: projectCreateData,
    });
  } else {
    await createOrUpdateProjectWithLegacyConfig({
      type: 'update',
      projectId,
      branchId: DEFAULT_BRANCH_ID,
      data: baseProjectData,
    });
  }

  const dummyTenancy = await getSoleTenancyFromProjectBranch(projectId, DEFAULT_BRANCH_ID);
  const dummyPrisma = await getPrismaClientForTenancy(dummyTenancy);

  const teamNameToId = await seedDummyTeams({
    prisma: dummyPrisma,
    tenancy: dummyTenancy,
  });
  const userEmailToId = await seedDummyUsers({
    prisma: dummyPrisma,
    tenancy: dummyTenancy,
    teamNameToId,
  });
  const { paymentsProducts, paymentsBranchOverride } = buildDummyPaymentsSetup();

  await Promise.all([
    overrideBranchConfigOverride({
      projectId,
      branchId: DEFAULT_BRANCH_ID,
      branchConfigOverrideOverride: {
        auth: {
          signUpRulesDefaultAction: "allow",
          signUpRules: {
            "allow-dummy-domain": {
              enabled: true,
              displayName: "Allow @dummy.dev",
              priority: 4,
              condition: 'emailDomain == "dummy.dev"',
              action: {
                type: "allow",
              },
            },
            "block-disposable-emails": {
              enabled: true,
              displayName: "Block disposable emails",
              priority: 3,
              condition: 'emailDomain.matches("(?i)mailinator\\\\.com|tempmail\\\\.com")',
              action: {
                type: "reject",
                message: "Disposable emails are not allowed",
              },
            },
            "restrict-free-domains": {
              enabled: true,
              displayName: "Restrict free email domains",
              priority: 2,
              condition: 'emailDomain in ["gmail.com", "yahoo.com", "outlook.com"]',
              action: {
                type: "restrict",
              },
            },
            "log-test-prefix": {
              enabled: true,
              displayName: "Log test+ emails",
              priority: 1,
              condition: 'email.startsWith("test+")',
              action: {
                type: "log",
              },
            },
          },
        },
        payments: paymentsBranchOverride as any,
        apps: {
          installed: typedFromEntries(typedEntries(ALL_APPS)
            .filter(([, app]) => !options.excludeAlphaApps || app.stage !== "alpha")
            .map(([key]) => [key, { enabled: true }])),
        },
      },
    }),
    overrideEnvironmentConfigOverride({
      projectId,
      branchId: DEFAULT_BRANCH_ID,
      environmentConfigOverrideOverride: {
        "payments.testMode": true,
      },
    }),
    ...options.skipGithubConfigSource ? [] : [setBranchConfigOverrideSource({
      projectId,
      branchId: DEFAULT_BRANCH_ID,
      source: {
        type: "pushed-from-github",
        owner: "stack-auth",
        repo: "dummy-config-repo",
        branch: "main",
        commit_hash: "abc123def456789",
        config_file_path: "stack.config.json",
      },
    })],
    globalPrismaClient.project.update({
      where: {
        id: projectId,
      },
      data: {
        stripeAccountId: "sample-stripe-account-id"
      },
    }),
  ]);

  await seedDummyTransactions({
    prisma: dummyPrisma,
    tenancyId: dummyTenancy.id,
    teamNameToId,
    userEmailToId,
    paymentsProducts,
  });

  await Promise.all([
    seedDummyEmails({
      prisma: dummyPrisma,
      tenancyId: dummyTenancy.id,
      userEmailToId,
    }),
    seedDummySessionActivityEvents({
      tenancyId: dummyTenancy.id,
      projectId,
      userEmailToId,
    }),
    seedDummySessionReplays({
      prisma: dummyPrisma,
      tenancyId: dummyTenancy.id,
      userEmailToId,
    }),
  ]);

  await seedBulkSignupsAndActivity({
    tenancy: dummyTenancy,
    prisma: dummyPrisma,
  });

  return projectId;
}

async function seedDummySessionReplays({
  prisma,
  tenancyId,
  userEmailToId,
  targetSessionReplayCount = 250,
}: {
  prisma: PrismaClientTransaction,
  tenancyId: string,
  userEmailToId: Map<string, string>,
  targetSessionReplayCount?: number,
}) {
  const userIds = Array.from(userEmailToId.values());
  if (userIds.length === 0) {
    throw new Error('Cannot seed session replays: no dummy project users exist');
  }

  // Anchor on midnight today so the seeded window is stable across re-runs
  // within the same day.
  const todayUtc = new Date();
  todayUtc.setUTCHours(0, 0, 0, 0);
  const twoWeeksAgo = new Date(todayUtc);
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
  const windowMs = todayUtc.getTime() - twoWeeksAgo.getTime();

  // Single seeded PRNG keyed off tenancy so the whole replay set is
  // deterministic across re-runs and identical IDs upsert in place.
  const rand = deterministicPrng(seedFromString(`session-replays:${tenancyId}`));

  const seeds: Prisma.SessionReplayCreateManyInput[] = [];
  for (let i = 0; i < targetSessionReplayCount; i++) {
    const startedAt = new Date(twoWeeksAgo.getTime() + rand() * windowMs);
    const durationMs = 10_000 + Math.floor(rand() * (20 * 60 * 1000)); // 10s..20m
    const lastEventAt = new Date(startedAt.getTime() + durationMs);
    const projectUserId = userIds[Math.floor(rand() * userIds.length)]!;

    seeds.push({
      tenancyId,
      refreshTokenId: deterministicUuid(`session-replay-refresh-token:${tenancyId}:${i}`),
      projectUserId,
      id: deterministicUuid(`session-replay:${tenancyId}:${i}`),
      startedAt,
      lastEventAt,
    });
  }

  // Delete existing deterministic IDs first, then bulk-insert (Prisma createMany
  // doesn't support upsert, so we delete+recreate to refresh timestamps).
  const seedIds = seeds.map((s) => s.id!);
  await prisma.sessionReplay.deleteMany({
    where: {
      tenancyId,
      id: { in: seedIds },
    },
  });
  await prisma.sessionReplay.createMany({
    data: seeds,
  });

  console.log(`Seeded ${targetSessionReplayCount} session replays`);
}
