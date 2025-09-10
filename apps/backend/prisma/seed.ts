/* eslint-disable no-restricted-syntax */
import { usersCrudHandlers } from '@/app/api/latest/users/crud';
import { overrideEnvironmentConfigOverride } from '@/lib/config';
import { grantTeamPermission, updatePermissionDefinition } from '@/lib/permissions';
import { createOrUpdateProjectWithLegacyConfig, getProject } from '@/lib/projects';
import { DEFAULT_BRANCH_ID, getSoleTenancyFromProjectBranch } from '@/lib/tenancies';
import { getPrismaClientForTenancy, globalPrismaClient } from '@/prisma-client';
import { PrismaClient } from '@prisma/client';
import { errorToNiceString, throwErr } from '@stackframe/stack-shared/dist/utils/errors';

const globalPrisma = new PrismaClient();

async function seed() {
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
        groups: {
          plans: {
            displayName: "Plans",
          }
        },
        offers: {
          team: {
            groupId: "plans",
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
            groupId: "plans",
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
            groupId: "plans",
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
            groupId: "plans",
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
      }
    }
  });

  await updatePermissionDefinition(
    globalPrismaClient,
    internalPrisma,
    {
      oldId: "team_member",
      scope: "team",
      tenancy: internalTenancy,
      data: {
        id: "team_member",
        description: "1",
        contained_permission_ids: ["$read_members"],
      }
    }
  );
  const updatedInternalTenancy = await getSoleTenancyFromProjectBranch("internal", DEFAULT_BRANCH_ID);
  await updatePermissionDefinition(
    globalPrismaClient,
    internalPrisma,
    {
      oldId: "team_admin",
      scope: "team",
      tenancy: updatedInternalTenancy,
      data: {
        id: "team_admin",
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

process.env.STACK_SEED_MODE = 'true';

seed().catch(async (e) => {
  console.error(errorToNiceString(e));
  await globalPrisma.$disconnect();
  process.exit(1);
  // eslint-disable-next-line @typescript-eslint/no-misused-promises
}).finally(async () => await globalPrisma.$disconnect());
