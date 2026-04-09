/* eslint-disable no-restricted-syntax */
import { teamMembershipsCrudHandlers } from '@/app/api/latest/team-memberships/crud';
import { teamsCrudHandlers } from '@/app/api/latest/teams/crud';
import { usersCrudHandlers } from '@/app/api/latest/users/crud';
import { CustomerType, EmailOutboxCreatedWith, Prisma, PurchaseCreationSource, SubscriptionStatus } from '@/generated/prisma/client';
import { getClickhouseAdminClient } from '@/lib/clickhouse';
import { overrideBranchConfigOverride, overrideEnvironmentConfigOverride, setBranchConfigOverrideSource } from '@/lib/config';
import { createOrUpdateProjectWithLegacyConfig, getProject } from '@/lib/projects';
import { DEFAULT_BRANCH_ID, getSoleTenancyFromProjectBranch, type Tenancy } from '@/lib/tenancies';
import { type PrismaClientTransaction, getPrismaClientForTenancy, globalPrismaClient } from '@/prisma-client';
import { ALL_APPS } from '@stackframe/stack-shared/dist/apps/apps-config';
import { DEFAULT_EMAIL_THEME_ID } from '@stackframe/stack-shared/dist/helpers/emails';
import { type AdminUserProjectsCrud, type ProjectsCrud } from '@stackframe/stack-shared/dist/interface/crud/projects';
import { DayInterval } from '@stackframe/stack-shared/dist/utils/dates';
import { getEnvVariable } from '@stackframe/stack-shared/dist/utils/env';
import { throwErr } from '@stackframe/stack-shared/dist/utils/errors';
import { typedEntries, typedFromEntries } from '@stackframe/stack-shared/dist/utils/objects';
import { generateUuid } from '@stackframe/stack-shared/dist/utils/uuids';

const EXPLORATORY_TEAM_DISPLAY_NAME = 'Exploratory Research and Insight Partnership With Very Long Collaborative Name For Testing';

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
    ],
  },
  {
    email: 'leo.park@dummy.dev',
    teamDisplayNames: ['Design Systems Lab', 'QA Collective'],
    primaryEmailVerified: false,
    isAnonymous: false,
    oauthProviders: [],
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
  },
  {
    displayName: 'Al',
    email: 'milo.adeyemi@dummy.dev',
    teamDisplayNames: [EXPLORATORY_TEAM_DISPLAY_NAME, 'Launch Council'],
    primaryEmailVerified: true,
    isAnonymous: true,
    oauthProviders: [],
  },
  {
    displayName: 'Priya Narang',
    email: 'priya.narang@dummy.dev',
    teamDisplayNames: ['Launch Council', 'Ops'],
    primaryEmailVerified: false,
    isAnonymous: false,
    oauthProviders: [
      { providerId: 'spotify', accountId: 'priya-narang-spotify' },
    ],
  },
  {
    displayName: 'Jonas Richter',
    email: 'jonas.richter@dummy.dev',
    profileImageUrl: 'https://avatar.vercel.sh/jonas-richter?size=96',
    teamDisplayNames: ['Launch Council', 'QA Collective'],
    primaryEmailVerified: true,
    isAnonymous: false,
    oauthProviders: [],
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
    ],
  },
  {
    displayName: 'Nia Holloway',
    email: 'nia.holloway@dummy.dev',
    teamDisplayNames: ['QA Collective'],
    primaryEmailVerified: true,
    isAnonymous: false,
    oauthProviders: [],
  },
  {
    displayName: 'Mateo Silva',
    email: 'mateo.silva@dummy.dev',
    teamDisplayNames: ['Growth Loop', 'Launch Council'],
    primaryEmailVerified: false,
    isAnonymous: false,
    oauthProviders: [
      { providerId: 'github', accountId: 'mateo-silva-gh' },
    ],
  },
  {
    displayName: 'Harper Lin',
    email: 'harper.lin@dummy.dev',
    teamDisplayNames: ['Growth Loop', 'Customer Advisory Board'],
    primaryEmailVerified: true,
    isAnonymous: false,
    oauthProviders: [],
  },
  {
    displayName: 'Zara Malik',
    email: 'zara.malik@dummy.dev',
    profileImageUrl: 'https://avatar.vercel.sh/zara-malik?size=96',
    teamDisplayNames: ['Prototype Garage', EXPLORATORY_TEAM_DISPLAY_NAME],
    primaryEmailVerified: true,
    isAnonymous: false,
    oauthProviders: [],
  },
  {
    displayName: 'Luca Bennett',
    email: 'luca.bennett@dummy.dev',
    teamDisplayNames: ['Growth Loop', 'Ops'],
    primaryEmailVerified: false,
    isAnonymous: false,
    oauthProviders: [],
  },
  {
    displayName: 'Evelyn Brooks',
    email: 'evelyn.brooks@dummy.dev',
    profileImageUrl: 'https://avatar.vercel.sh/evelyn-brooks?size=96&background=15803d&color=fff',
    teamDisplayNames: ['Customer Advisory Board'],
    primaryEmailVerified: true,
    isAnonymous: false,
    oauthProviders: [],
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
    ],
  },
  {
    email: 'naomi.patel@dummy.dev',
    teamDisplayNames: ['Prototype Garage', 'Design Systems Lab'],
    primaryEmailVerified: false,
    isAnonymous: false,
    oauthProviders: [],
  },
  {
    displayName: 'Kai Romero',
    email: 'kai.romero@dummy.dev',
    teamDisplayNames: ['Growth Loop'],
    primaryEmailVerified: true,
    isAnonymous: false,
    oauthProviders: [],
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
  };

  const paymentsBranchOverride = {
    productLines: {
      workspace: {
        displayName: 'Workspace Plans',
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

async function seedDummySessionActivityEvents(options: SessionActivityEventSeedOptions) {
  const { tenancyId, projectId, userEmailToId } = options;

  const now = new Date();
  const twoMonthsAgo = new Date(now);
  twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);

  const userEmails = Array.from(userEmailToId.keys());

  const ipInfoBatch: Prisma.EventIpInfoCreateManyInput[] = [];
  const eventBatch: Prisma.EventCreateManyInput[] = [];
  const clickhouseBatch: Array<{
    event_type: string,
    event_at: Date,
    data: Record<string, unknown>,
    project_id: string,
    branch_id: string,
    user_id: string | null,
    team_id: string | null,
    refresh_token_id: string | null,
    session_replay_id: string | null,
    session_replay_segment_id: string | null,
  }> = [];

  for (const email of userEmails) {
    const userId = userEmailToId.get(email);
    if (!userId) continue;

    const eventCount = 15 + Math.floor(Math.random() * 11);

    for (let i = 0; i < eventCount; i++) {
      const randomTime = new Date(
        twoMonthsAgo.getTime() + Math.random() * (now.getTime() - twoMonthsAgo.getTime())
      );

      const location = sessionActivityLocations[Math.floor(Math.random() * sessionActivityLocations.length)];
      const sessionId = `session-${userId.substring(0, 8)}-${i.toString().padStart(3, '0')}-${randomTime.getTime().toString(36)}`;
      const ipAddress = `${10 + Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`;
      const refreshTokenId = `seed-refresh-${generateUuid()}`;

      const ipInfoId = generateUuid();
      const eventId = generateUuid();

      ipInfoBatch.push({
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

      eventBatch.push({
        id: eventId,
        systemEventTypeIds: ['$session-activity', '$user-activity', '$project-activity', '$project'],
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

      // Also create $token-refresh events for ClickHouse (used by globe + analytics)
      clickhouseBatch.push({
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

  // Batch insert into Postgres
  await globalPrismaClient.eventIpInfo.createMany({
    data: ipInfoBatch,
    skipDuplicates: true,
  });

  await globalPrismaClient.event.createMany({
    data: eventBatch,
    skipDuplicates: true,
  });

  // Batch insert into ClickHouse for analytics/globe
  const clickhouseUrl = getEnvVariable("STACK_CLICKHOUSE_URL", "");
  if (clickhouseUrl) {
    const clickhouseClient = getClickhouseAdminClient();
    await clickhouseClient.insert({
      table: "analytics_internal.events",
      values: clickhouseBatch,
      format: "JSONEachRow",
      clickhouse_settings: {
        date_time_input_format: "best_effort",
      },
    });
  }
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

  return projectId;
}

async function seedDummySessionReplays({
  prisma,
  tenancyId,
  userEmailToId,
}: {
  prisma: PrismaClientTransaction,
  tenancyId: string,
  userEmailToId: Map<string, string>,
}) {
  const now = new Date();
  const usersToReplay = [
    'amelia.chen@dummy.dev',
    'mateo.silva@dummy.dev',
    'priya.narang@dummy.dev',
  ];

  for (const email of usersToReplay) {
    const userId = userEmailToId.get(email);
    if (!userId) continue;

    const replayId = generateUuid();
    const batchId = generateUuid();
    const chunkId = generateUuid();
    const segmentId = generateUuid();
    const browserSessionId = generateUuid();
    const refreshTokenId = generateUuid();

    // Each replay started 1-7 days ago, lasted ~8 seconds
    const daysAgo = 1 + Math.floor(Math.random() * 7);
    const startedAt = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
    const lastEventAt = new Date(startedAt.getTime() + 8000);

    await prisma.sessionReplay.upsert({
      where: { tenancyId_id: { tenancyId, id: replayId } },
      update: {},
      create: {
        id: replayId,
        tenancyId,
        projectUserId: userId,
        refreshTokenId,
        startedAt,
        lastEventAt,
      },
    });

    await prisma.sessionReplayChunk.upsert({
      where: { tenancyId_sessionReplayId_batchId: { tenancyId, sessionReplayId: replayId, batchId } },
      update: {},
      create: {
        id: chunkId,
        tenancyId,
        sessionReplayId: replayId,
        batchId,
        sessionReplaySegmentId: segmentId,
        browserSessionId,
        s3Key: `preview://${replayId}/${batchId}`,
        eventCount: 8,
        byteLength: 0,
        firstEventAt: startedAt,
        lastEventAt,
      },
    });
  }
}
