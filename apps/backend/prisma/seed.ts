/* eslint-disable no-restricted-syntax */
import { teamMembershipsCrudHandlers } from '@/app/api/latest/team-memberships/crud';
import { teamsCrudHandlers } from '@/app/api/latest/teams/crud';
import { usersCrudHandlers } from '@/app/api/latest/users/crud';
import { overrideEnvironmentConfigOverride } from '@/lib/config';
import { ensurePermissionDefinition, grantTeamPermission } from '@/lib/permissions';
import { createOrUpdateProjectWithLegacyConfig, getProject } from '@/lib/projects';
import { DEFAULT_BRANCH_ID, getSoleTenancyFromProjectBranch, type Tenancy } from '@/lib/tenancies';
import { getPrismaClientForTenancy, globalPrismaClient } from '@/prisma-client';
import { CustomerType, Prisma, PrismaClient, PurchaseCreationSource, SubscriptionStatus } from '@prisma/client';
import { ALL_APPS } from '@stackframe/stack-shared/dist/apps/apps-config';
import { DEFAULT_EMAIL_THEME_ID } from '@stackframe/stack-shared/dist/helpers/emails';
import { AdminUserProjectsCrud, ProjectsCrud } from '@stackframe/stack-shared/dist/interface/crud/projects';
import { DayInterval } from '@stackframe/stack-shared/dist/utils/dates';
import { throwErr } from '@stackframe/stack-shared/dist/utils/errors';
import { typedEntries, typedFromEntries } from '@stackframe/stack-shared/dist/utils/objects';

const globalPrisma = new PrismaClient();
const DUMMY_PROJECT_ID = '6fbbf22e-f4b2-4c6e-95a1-beab6fa41063';
const EXPLORATORY_TEAM_DISPLAY_NAME = 'Exploratory Research and Insight Partnership With Very Long Collaborative Name For Testing';

export async function seed() {
  process.env.STACK_SEED_MODE = 'true';
  console.log('Seeding database...');

  // Optional default admin user
  const adminEmail = process.env.STACK_SEED_INTERNAL_PROJECT_USER_EMAIL;
  const adminPassword = process.env.STACK_SEED_INTERNAL_PROJECT_USER_PASSWORD;
  const adminInternalAccess = process.env.STACK_SEED_INTERNAL_PROJECT_USER_INTERNAL_ACCESS === 'true';
  const adminGithubId = process.env.STACK_SEED_INTERNAL_PROJECT_USER_GITHUB_ID;

  // dashboard settings
  const dashboardDomain = process.env.NEXT_PUBLIC_STACK_DASHBOARD_URL;
  const oauthProviderIds = process.env.STACK_SEED_INTERNAL_PROJECT_OAUTH_PROVIDERS?.split(',') ?? [];
  const otpEnabled = process.env.STACK_SEED_INTERNAL_PROJECT_OTP_ENABLED === 'true';
  const signUpEnabled = process.env.STACK_SEED_INTERNAL_PROJECT_SIGN_UP_ENABLED === 'true';
  const allowLocalhost = process.env.STACK_SEED_INTERNAL_PROJECT_ALLOW_LOCALHOST === 'true';

  const emulatorEnabled = process.env.STACK_EMULATOR_ENABLED === 'true';
  const emulatorProjectId = process.env.STACK_EMULATOR_PROJECT_ID;

  const apiKeyId = '3142e763-b230-44b5-8636-aa62f7489c26';
  const defaultUserId = '33e7c043-d2d1-4187-acd3-f91b5ed64b46';
  const internalTeamId = 'a23e1b7f-ab18-41fc-9ee6-7a9ca9fa543c';
  const emulatorAdminUserId = '63abbc96-5329-454a-ba56-e0460173c6c1';
  const emulatorAdminTeamId = '5a0c858b-d9e9-49d4-9943-8ce385d86428';

  let internalProject = await getProject('internal');

  if (!internalProject) {
    internalProject = await createOrUpdateProjectWithLegacyConfig({
      type: 'create',
      projectId: 'internal',
      data: {
        display_name: 'Stack Dashboard',
        owner_team_id: internalTeamId,
        description: 'Stack\'s admin dashboard',
        is_production_mode: false,
        config: {
          allow_localhost: true,
          oauth_providers: oauthProviderIds.map((id) => ({
            id: id as any,
            type: 'shared',
          })),
          sign_up_enabled: signUpEnabled,
          credential_enabled: true,
          magic_link_enabled: otpEnabled,
        },
      },
    });

    console.log('Internal project created');
  }

  const internalTenancy = await getSoleTenancyFromProjectBranch("internal", DEFAULT_BRANCH_ID);
  const internalPrisma = await getPrismaClientForTenancy(internalTenancy);

  internalProject = await createOrUpdateProjectWithLegacyConfig({
    projectId: 'internal',
    branchId: DEFAULT_BRANCH_ID,
    type: 'update',
    data: {
      config: {
        create_team_on_sign_up: true,
        sign_up_enabled: signUpEnabled,
        magic_link_enabled: otpEnabled,
        allow_localhost: allowLocalhost,
        client_team_creation_enabled: true,
        domains: [
          ...(dashboardDomain && new URL(dashboardDomain).hostname !== 'localhost' ? [{ domain: dashboardDomain, handler_path: '/handler' }] : []),
          ...Object.values(internalTenancy.config.domains.trustedDomains)
            .filter((d) => d.baseUrl !== dashboardDomain && d.baseUrl)
            .map((d) => ({ domain: d.baseUrl || throwErr('Domain base URL is required'), handler_path: d.handlerPath })),
        ],
      },
    },
  });

  await overrideEnvironmentConfigOverride({
    projectId: 'internal',
    branchId: DEFAULT_BRANCH_ID,
    environmentConfigOverrideOverride: {
      dataVault: {
        stores: {
          'neon-connection-strings': {
            displayName: 'Neon Connection Strings',
          }
        }
      },
      payments: {
        catalogs: {
          plans: {
            displayName: "Plans",
          }
        },
        products: {
          team: {
            catalogId: "plans",
            displayName: "Team",
            customerType: "team",
            serverOnly: false,
            stackable: false,
            prices: {
              monthly: {
                USD: "49",
                interval: [1, "month"] as any,
                serverOnly: false
              }
            },
            includedItems: {
              dashboard_admins: {
                quantity: 3,
                repeat: "never",
                expires: "when-purchase-expires"
              }
            }
          },
          growth: {
            catalogId: "plans",
            displayName: "Growth",
            customerType: "team",
            serverOnly: false,
            stackable: false,
            prices: {
              monthly: {
                USD: "299",
                interval: [1, "month"] as any,
                serverOnly: false
              }
            },
            includedItems: {
              dashboard_admins: {
                quantity: 5,
                repeat: "never",
                expires: "when-purchase-expires"
              }
            }
          },
          free: {
            catalogId: "plans",
            displayName: "Free",
            customerType: "team",
            serverOnly: false,
            stackable: false,
            prices: "include-by-default",
            includedItems: {
              dashboard_admins: {
                quantity: 1,
                repeat: "never",
                expires: "when-purchase-expires"
              }
            }
          },
          "extra-admins": {
            catalogId: "plans",
            displayName: "Extra Admins",
            customerType: "team",
            serverOnly: false,
            stackable: true,
            prices: {
              monthly: {
                USD: "49",
                interval: [1, "month"] as any,
                serverOnly: false
              }
            },
            includedItems: {
              dashboard_admins: {
                quantity: 1,
                repeat: "never",
                expires: "when-purchase-expires"
              }
            },
            isAddOnTo: {
              team: true,
              growth: true,
            }
          }
        },
        items: {
          dashboard_admins: {
            displayName: "Dashboard Admins",
            customerType: "team"
          }
        },
      },
      apps: {
        installed: typedFromEntries(typedEntries(ALL_APPS).map(([key, value]) => [key, { enabled: true }])),
      },
    }
  });

  await ensurePermissionDefinition(
    globalPrismaClient,
    internalPrisma,
    {
      id: "team_member",
      scope: "team",
      tenancy: internalTenancy,
      data: {
        description: "1",
        contained_permission_ids: ["$read_members"],
      }
    }
  );
  const updatedInternalTenancy = await getSoleTenancyFromProjectBranch("internal", DEFAULT_BRANCH_ID);
  await ensurePermissionDefinition(
    globalPrismaClient,
    internalPrisma,
    {
      id: "team_admin",
      scope: "team",
      tenancy: updatedInternalTenancy,
      data: {
        description: "2",
        contained_permission_ids: ["$read_members", "$remove_members", "$update_team"],
      }
    }
  );


  const internalTeam = await internalPrisma.team.findUnique({
    where: {
      tenancyId_teamId: {
        tenancyId: internalTenancy.id,
        teamId: internalTeamId,
      },
    },
  });
  if (!internalTeam) {
    await internalPrisma.team.create({
      data: {
        tenancyId: internalTenancy.id,
        teamId: internalTeamId,
        displayName: 'Internal Team',
        mirroredProjectId: 'internal',
        mirroredBranchId: DEFAULT_BRANCH_ID,
      },
    });
    console.log('Internal team created');
  }

  const shouldSeedDummyProject = Boolean(process.env.STACK_SEED_ENABLE_DUMMY_PROJECT);
  if (shouldSeedDummyProject) {
    await seedDummyProject({
      internalPrisma,
      ownerTeamId: internalTeamId,
      oauthProviderIds,
    });
  }

  const keySet = {
    publishableClientKey: process.env.STACK_SEED_INTERNAL_PROJECT_PUBLISHABLE_CLIENT_KEY || throwErr('STACK_SEED_INTERNAL_PROJECT_PUBLISHABLE_CLIENT_KEY is not set'),
    secretServerKey: process.env.STACK_SEED_INTERNAL_PROJECT_SECRET_SERVER_KEY || throwErr('STACK_SEED_INTERNAL_PROJECT_SECRET_SERVER_KEY is not set'),
    superSecretAdminKey: process.env.STACK_SEED_INTERNAL_PROJECT_SUPER_SECRET_ADMIN_KEY || throwErr('STACK_SEED_INTERNAL_PROJECT_SUPER_SECRET_ADMIN_KEY is not set'),
  };

  await globalPrisma.apiKeySet.upsert({
    where: { projectId_id: { projectId: 'internal', id: apiKeyId } },
    update: {
      ...keySet,
    },
    create: {
      id: apiKeyId,
      projectId: 'internal',
      description: "Internal API key set",
      expiresAt: new Date('2099-12-31T23:59:59Z'),
      ...keySet,
    }
  });

  console.log('Updated internal API key set');

  // Create optional default admin user if credentials are provided.
  // This user will be able to login to the dashboard with both email/password and magic link.

  if ((adminEmail && adminPassword) || adminGithubId) {
    const oldAdminUser = await internalPrisma.projectUser.findFirst({
      where: {
        mirroredProjectId: 'internal',
        mirroredBranchId: DEFAULT_BRANCH_ID,
        projectUserId: defaultUserId
      }
    });

    if (oldAdminUser) {
      console.log(`Admin user already exists, skipping creation`);
    } else {
      const newUser = await internalPrisma.projectUser.create({
        data: {
          displayName: 'Administrator (created by seed script)',
          projectUserId: defaultUserId,
          tenancyId: internalTenancy.id,
          mirroredProjectId: 'internal',
          mirroredBranchId: DEFAULT_BRANCH_ID,
        }
      });

      if (adminInternalAccess) {
        await internalPrisma.teamMember.create({
          data: {
            tenancyId: internalTenancy.id,
            teamId: internalTeamId,
            projectUserId: defaultUserId,
          },
        });
      }

      if (adminEmail && adminPassword) {
        await usersCrudHandlers.adminUpdate({
          tenancy: internalTenancy,
          user_id: defaultUserId,
          data: {
            password: adminPassword,
            primary_email: adminEmail,
            primary_email_auth_enabled: true,
          },
        });

        console.log(`Added admin user with email ${adminEmail}`);
      }

      if (adminGithubId) {
        const githubAccount = await internalPrisma.projectUserOAuthAccount.findFirst({
          where: {
            tenancyId: internalTenancy.id,
            configOAuthProviderId: 'github',
            providerAccountId: adminGithubId,
          }
        });

        if (githubAccount) {
          console.log(`GitHub account already exists, skipping creation`);
        } else {
          await internalPrisma.projectUserOAuthAccount.create({
            data: {
              tenancyId: internalTenancy.id,
              projectUserId: newUser.projectUserId,
              configOAuthProviderId: 'github',
              providerAccountId: adminGithubId
            }
          });

          await internalPrisma.authMethod.create({
            data: {
              tenancyId: internalTenancy.id,
              projectUserId: newUser.projectUserId,
              oauthAuthMethod: {
                create: {
                  projectUserId: newUser.projectUserId,
                  configOAuthProviderId: 'github',
                  providerAccountId: adminGithubId,
                }
              }
            }
          });

          console.log(`Added admin user with GitHub ID ${adminGithubId}`);
        }
      }
    }

    await grantTeamPermission(internalPrisma, {
      tenancy: internalTenancy,
      teamId: internalTeamId,
      userId: defaultUserId,
      permissionId: "team_admin",
    });
  }

  if (emulatorEnabled) {
    if (!emulatorProjectId) {
      throw new Error('STACK_EMULATOR_PROJECT_ID is not set');
    }

    const emulatorTeam = await internalPrisma.team.findUnique({
      where: {
        tenancyId_teamId: {
          tenancyId: internalTenancy.id,
          teamId: emulatorAdminTeamId,
        },
      },
    });
    if (!emulatorTeam) {
      await internalPrisma.team.create({
        data: {
          tenancyId: internalTenancy.id,
          teamId: emulatorAdminTeamId,
          displayName: 'Emulator Team',
          mirroredProjectId: "internal",
          mirroredBranchId: DEFAULT_BRANCH_ID,
        },
      });
      console.log('Created emulator team');
    }

    const existingUser = await internalPrisma.projectUser.findFirst({
      where: {
        mirroredProjectId: 'internal',
        mirroredBranchId: DEFAULT_BRANCH_ID,
        projectUserId: emulatorAdminUserId,
      }
    });

    if (existingUser) {
      console.log('Emulator user already exists, skipping creation');
    } else {
      const newEmulatorUser = await internalPrisma.projectUser.create({
        data: {
          displayName: 'Local Emulator User',
          projectUserId: emulatorAdminUserId,
          tenancyId: internalTenancy.id,
          mirroredProjectId: 'internal',
          mirroredBranchId: DEFAULT_BRANCH_ID,
        }
      });

      await internalPrisma.teamMember.create({
        data: {
          tenancyId: internalTenancy.id,
          teamId: emulatorAdminTeamId,
          projectUserId: newEmulatorUser.projectUserId,
        },
      });

      await usersCrudHandlers.adminUpdate({
        tenancy: internalTenancy,
        user_id: newEmulatorUser.projectUserId,
        data: {
          password: 'LocalEmulatorPassword',
          primary_email: 'local-emulator@stack-auth.com',
          primary_email_auth_enabled: true,
        },
      });

      console.log('Created emulator user');
    }

    const existingProject = await internalPrisma.project.findUnique({
      where: {
        id: emulatorProjectId,
      },
    });

    if (existingProject) {
      console.log('Emulator project already exists, skipping creation');
    } else {
      await createOrUpdateProjectWithLegacyConfig({
        projectId: emulatorProjectId,
        type: 'create',
        data: {
          display_name: 'Emulator Project',
          owner_team_id: emulatorAdminTeamId,
          config: {
            allow_localhost: true,
            create_team_on_sign_up: false,
            client_team_creation_enabled: false,
            passkey_enabled: true,
            oauth_providers: oauthProviderIds.map((id) => ({
              id: id as any,
              type: 'shared',
            })),
          }
        },
      });

      console.log('Created emulator project');
    }
  }

  console.log('Seeding complete!');
}

type DummyProjectSeedOptions = {
  internalPrisma: PrismaClient,
  ownerTeamId: string,
  oauthProviderIds: string[],
};

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
  prisma: PrismaClient,
  tenancy: Tenancy,
};

type SeedDummyUsersOptions = {
  prisma: PrismaClient,
  tenancy: Tenancy,
  teamNameToId: Map<string, string>,
};

type PaymentsSetup = {
  paymentsProducts: Record<string, unknown>,
  paymentsOverride: Record<string, unknown>,
};

async function seedDummyTeams(options: SeedDummyTeamsOptions): Promise<Map<string, string>> {
  const { prisma, tenancy } = options;

  const teamSeeds = [
    { displayName: 'Design Systems Lab', profileImageUrl: 'https://avatar.vercel.sh/design-systems?size=96&background=312e81&color=fff' },
    { displayName: 'Prototype Garage' },
    { displayName: EXPLORATORY_TEAM_DISPLAY_NAME, profileImageUrl: 'https://avatar.vercel.sh/exploratory-research?size=96&background=2563eb&color=fff' },
    { displayName: 'Launch Council', profileImageUrl: 'https://avatar.vercel.sh/launch-council?size=96&background=172554&color=fff' },
    { displayName: 'Growth Loop', profileImageUrl: 'https://avatar.vercel.sh/growth-loop?size=96&background=16a34a&color=fff' },
    { displayName: 'QA Collective' },
    { displayName: 'Customer Advisory Board', profileImageUrl: 'https://avatar.vercel.sh/customer-advisory?size=96&background=854d0e&color=fff' },
    { displayName: 'Ops', profileImageUrl: 'https://avatar.vercel.sh/ops-team?size=96&background=ea580c&color=fff' },
  ] satisfies TeamSeed[];

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

  const userSeeds = [
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
  ] satisfies UserSeed[];

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

  const paymentsProducts = {
    'starter': {
      displayName: 'Starter',
      catalogId: 'workspace',
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
      catalogId: 'workspace',
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
      catalogId: 'add_ons',
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

  const paymentsOverride = {
    testMode: true,
    catalogs: {
      workspace: {
        displayName: 'Workspace Plans',
      },
      add_ons: {
        displayName: 'Add-ons',
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

  return {
    paymentsProducts,
    paymentsOverride,
  };
}

async function seedDummyProject(options: DummyProjectSeedOptions) {
  const baseProjectData = {
    display_name: 'Dummy Project',
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

  const existingProject = await getProject(DUMMY_PROJECT_ID);
  if (!existingProject) {
    await createOrUpdateProjectWithLegacyConfig({
      type: 'create',
      projectId: DUMMY_PROJECT_ID,
      data: projectCreateData,
    });
    console.log('Created dummy project');
  } else {
    await createOrUpdateProjectWithLegacyConfig({
      type: 'update',
      projectId: DUMMY_PROJECT_ID,
      branchId: DEFAULT_BRANCH_ID,
      data: baseProjectData,
    });
  }

  const dummyTenancy = await getSoleTenancyFromProjectBranch(DUMMY_PROJECT_ID, DEFAULT_BRANCH_ID);
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
  const { paymentsProducts, paymentsOverride } = buildDummyPaymentsSetup();

  await overrideEnvironmentConfigOverride({
    projectId: DUMMY_PROJECT_ID,
    branchId: DEFAULT_BRANCH_ID,
    environmentConfigOverrideOverride: {
      payments: paymentsOverride as any,
      apps: {
        installed: typedFromEntries(typedEntries(ALL_APPS).map(([key]) => [key, { enabled: true }])),
      },
    },
  });

  await options.internalPrisma.project.update({
    where: {
      id: DUMMY_PROJECT_ID,
    },
    data: {
      stripeAccountId: "sample-stripe-account-id"
    },
  });

  await seedDummyTransactions({
    prisma: dummyPrisma,
    tenancyId: dummyTenancy.id,
    teamNameToId,
    userEmailToId,
    paymentsProducts,
  });

  await seedDummyEmails({
    prisma: dummyPrisma,
    tenancyId: dummyTenancy.id,
    userEmailToId,
  });

  console.log('Seeded dummy project data');
}

type TransactionsSeedOptions = {
  prisma: PrismaClient,
  tenancyId: string,
  teamNameToId: Map<string, string>,
  userEmailToId: Map<string, string>,
  paymentsProducts: Record<string, unknown>,
};

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

type EmailSeedOptions = {
  prisma: PrismaClient,
  tenancyId: string,
  userEmailToId: Map<string, string>,
};

type EmailSeed = {
  id: string,
  subject: string,
  to: string[],
  senderConfig: Prisma.InputJsonValue,
  html?: string,
  text?: string,
  error?: Prisma.InputJsonValue | null,
  createdAt: Date,
  userEmail?: string,
};

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const DUMMY_SEED_IDS = {
  subscriptions: {
    designSystemsGrowth: 'a296195f-c460-4cd6-b4c4-6cd359b4c643',
    prototypeStarterTrial: '5a255248-4d42-4d61-95f9-f53e97c3f2dd',
    growthLoopRegression: '813c4380-475b-4cb8-ac1a-5204d9839b36',
    mateoGrowthAnnual: 'c4acea49-302a-43b9-82a7-446b19e0e662',
    legacyEnterprise: '11664974-38ff-4356-8e39-2fa9105ed84f',
  },
  itemQuantityChanges: {
    designSeatsGrant: '44ca1801-0732-4273-ae14-4fd1c3999e24',
    growthSnapshotAdjustment: 'aad066cd-d853-4bec-97ae-91154bcd4897',
    opsAutomationCredit: 'a3e515dd-9332-4b15-b41a-90b9d6a37276',
    legacyReviewPass: 'b3c20e4f-608d-4c34-9c18-4a5c63780666',
  },
  oneTimePurchases: {
    qaAddon: '9718d5b1-d993-4979-ad68-532f225605ab',
    ameliaSeatPack: '0b696a83-c54e-4a74-ae47-3ac5a4db49e6',
    launchCouncilUpfront: '10766081-37fd-410c-8b2e-1c3351e2d364',
    designAuditPass: '5939f45e-1cf0-4f76-98f9-d999ed45405b',
  },
  emails: {
    welcomeAmelia: 'af8cfd90-8912-4bf7-93a7-20ff2be54767',
    passkeyMilo: 'd534d777-5aa2-4014-a198-6484bbadcbf2',
    invitePriya: 'b7e31f58-cfd7-46cd-920f-d7616ad66bed',
    statusDigest: '2423e8d8-72cf-4355-a475-c2028e3ea958',
    templateFailure: 'faa33233-ba8d-4819-a89a-d442003cd589',
  },
} as const;

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
      id: DUMMY_SEED_IDS.subscriptions.growthLoopRegression,
      customerType: CustomerType.TEAM,
      customerId: resolveTeamId('Growth Loop'),
      productId: 'regression-addon',
      priceId: 'monthly',
      product: resolveProduct('regression-addon'),
      quantity: 3,
      status: SubscriptionStatus.past_due,
      creationSource: PurchaseCreationSource.PURCHASE_PAGE,
      currentPeriodStart: new Date('2024-04-15T00:00:00.000Z'),
      currentPeriodEnd: new Date('2024-05-15T00:00:00.000Z'),
      cancelAtPeriodEnd: true,
      stripeSubscriptionId: 'sub_regression_growthloop',
      createdAt: new Date('2024-04-10T12:00:00.000Z'),
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
        catalogId: 'workspace',
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
      id: DUMMY_SEED_IDS.itemQuantityChanges.growthSnapshotAdjustment,
      customerType: CustomerType.TEAM,
      customerId: resolveTeamId('Growth Loop'),
      itemId: 'snapshot_credits',
      quantity: -80,
      description: 'Snapshot overage adjustment',
      expiresAt: null,
      createdAt: new Date('2024-05-28T12:00:00.000Z'),
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
      id: DUMMY_SEED_IDS.oneTimePurchases.qaAddon,
      customerType: CustomerType.TEAM,
      customerId: resolveTeamId('QA Collective'),
      productId: 'regression-addon',
      priceId: 'monthly',
      product: resolveProduct('regression-addon'),
      quantity: 1,
      creationSource: PurchaseCreationSource.PURCHASE_PAGE,
      stripePaymentIntentId: 'pi_regression_addon',
      createdAt: new Date('2024-05-05T00:00:00.000Z'),
    },
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
    {
      id: DUMMY_SEED_IDS.oneTimePurchases.designAuditPass,
      customerType: CustomerType.CUSTOM,
      customerId: 'design-audit-partner',
      productId: 'design-audit-pass',
      priceId: 'one_time',
      product: cloneJson({
        displayName: 'Design Audit Pass',
        catalogId: 'add_ons',
        customerType: 'custom',
        prices: {
          one_time: {
            USD: '2500',
          },
        },
      }),
      quantity: 2,
      creationSource: PurchaseCreationSource.API_GRANT,
      stripePaymentIntentId: 'pi_design_audit_pass',
      createdAt: new Date('2024-04-22T00:00:00.000Z'),
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

  const emailSeeds: EmailSeed[] = [
    {
      id: DUMMY_SEED_IDS.emails.welcomeAmelia,
      subject: 'Welcome to Dummy Project',
      to: ['amelia.chen@dummy.dev'],
      senderConfig: {
        type: 'standard',
        host: 'smtp.stack.local',
        port: 587,
        username: 'stack-app',
        senderName: 'Dummy Project',
        senderEmail: 'hello@dummy.dev',
      },
      html: '<p>Hi Amelia,<br/>Welcome to Dummy Project.</p>',
      text: 'Hi Amelia,\nWelcome to Dummy Project.',
      createdAt: new Date('2024-05-01T13:00:00.000Z'),
      userEmail: 'amelia.chen@dummy.dev',
    },
    {
      id: DUMMY_SEED_IDS.emails.passkeyMilo,
      subject: 'Your passkey sign-in link',
      to: ['milo.adeyemi@dummy.dev'],
      senderConfig: {
        type: 'standard',
        host: 'smtp.stack.local',
        port: 587,
        username: 'auth-service',
        senderName: 'Dummy Auth',
        senderEmail: 'auth@dummy.dev',
      },
      html: '<p>Complete your sign-in within <strong>10 minutes</strong>.</p>',
      text: 'Complete your sign-in within 10 minutes.',
      createdAt: new Date('2024-05-02T10:00:00.000Z'),
      userEmail: 'milo.adeyemi@dummy.dev',
    },
    {
      id: DUMMY_SEED_IDS.emails.invitePriya,
      subject: 'Dashboard invite for Ops',
      to: ['priya.narang@dummy.dev', 'ops@dummy.dev'],
      senderConfig: {
        type: 'standard',
        host: 'smtp-relay.dummy.dev',
        port: 2525,
        username: 'relay-invite',
        senderName: 'Stack Invitations',
        senderEmail: 'invites@dummy.dev',
      },
      html: '<p>Your admin invitation could not be delivered.</p>',
      error: {
        message: 'Mailbox full',
        code: 'MAILBOX_FULL',
        smtpResponse: '552 Requested mail action aborted: exceeded storage allocation',
      },
      createdAt: new Date('2024-05-04T18:30:00.000Z'),
      userEmail: 'priya.narang@dummy.dev',
    },
    {
      id: DUMMY_SEED_IDS.emails.statusDigest,
      subject: 'Nightly status digest',
      to: ['ops@dummy.dev', 'observer@dummy.dev'],
      senderConfig: {
        type: 'standard',
        host: 'api.resend.com',
        port: 443,
        username: 'resend-live',
        senderName: 'Dummy Alerts',
        senderEmail: 'alerts@dummy.dev',
      },
      text: 'All services operational. 3 warnings acknowledged.',
      createdAt: new Date('2024-05-06T07:45:00.000Z'),
    },
    {
      id: DUMMY_SEED_IDS.emails.templateFailure,
      subject: 'Template rendering failed - Review',
      to: ['dev@dummy.dev'],
      senderConfig: {
        type: 'standard',
        host: 'smtp.stack.local',
        port: 465,
        username: 'template-engine',
        senderName: 'Dummy System',
        senderEmail: 'system@dummy.dev',
      },
      html: '<p>Rendering failed due to <code>undefined</code> data from billing.</p>',
      error: {
        message: 'Template render error',
        stack: 'ReferenceError: account is not defined',
      },
      createdAt: new Date('2024-05-08T12:05:00.000Z'),
    },
  ];

  for (const email of emailSeeds) {
    const userId = resolveOptionalUserId(email.userEmail);
    await prisma.sentEmail.upsert({
      where: {
        tenancyId_id: {
          tenancyId,
          id: email.id,
        },
      },
      update: {
        subject: email.subject,
        to: email.to,
        senderConfig: email.senderConfig,
        html: email.html ?? null,
        text: email.text ?? null,
        error: email.error ?? Prisma.JsonNull,
        userId,
      },
      create: {
        tenancyId,
        id: email.id,
        subject: email.subject,
        to: email.to,
        senderConfig: email.senderConfig,
        html: email.html ?? null,
        text: email.text ?? null,
        error: email.error ?? Prisma.JsonNull,
        userId,
        createdAt: email.createdAt,
      },
    });
  }
}
