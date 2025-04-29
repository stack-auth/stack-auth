/* eslint-disable no-restricted-syntax */
import { PrismaClient } from '@prisma/client';
import { errorToNiceString, throwErr } from '@stackframe/stack-shared/dist/utils/errors';
import { usersCrudHandlers } from '../src/app/api/latest/users/crud';
import { createOrUpdateProject, getProject } from '../src/lib/projects';
import { getSoleTenancyFromProject } from '../src/lib/tenancies';

const prisma = new PrismaClient();

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
  const emulatorAdminUserId = '63abbc96-5329-454a-ba56-e0460173c6c1';

  let internalProject = await getProject('internal');

  if (!internalProject) {
    internalProject = await createOrUpdateProject({
      type: 'create',
      initialBranchId: 'main',
      projectId: 'internal',
      data: {
        display_name: 'Stack Dashboard',
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

  const internalTenancy = await getSoleTenancyFromProject("internal");

  internalProject = await createOrUpdateProject({
    projectId: 'internal',
    type: 'update',
    data: {
      config: {
        sign_up_enabled: signUpEnabled,
        magic_link_enabled: otpEnabled,
        allow_localhost: allowLocalhost,
        domains: [
          ...(dashboardDomain && new URL(dashboardDomain).hostname !== 'localhost' ? [{ domain: dashboardDomain, handler_path: '/handler' }] : []),
          ...internalProject.config.domains.filter((d) => d.domain !== dashboardDomain),
        ]
      },
    },
  });

  const keySet = {
    publishableClientKey: process.env.STACK_SEED_INTERNAL_PROJECT_PUBLISHABLE_CLIENT_KEY || throwErr('STACK_SEED_INTERNAL_PROJECT_PUBLISHABLE_CLIENT_KEY is not set'),
    secretServerKey: process.env.STACK_SEED_INTERNAL_PROJECT_SECRET_SERVER_KEY || throwErr('STACK_SEED_INTERNAL_PROJECT_SECRET_SERVER_KEY is not set'),
    superSecretAdminKey: process.env.STACK_SEED_INTERNAL_PROJECT_SUPER_SECRET_ADMIN_KEY || throwErr('STACK_SEED_INTERNAL_PROJECT_SUPER_SECRET_ADMIN_KEY is not set'),
  };

  await prisma.apiKeySet.upsert({
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
    const oldAdminUser = await prisma.projectUser.findFirst({
      where: {
        mirroredProjectId: 'internal',
        mirroredBranchId: 'main',
        projectUserId: defaultUserId
      }
    });

    if (oldAdminUser) {
        console.log(`Admin user already exists, skipping creation`);
    } else {
      const newUser = await prisma.projectUser.create({
        data: {
          displayName: 'Administrator (created by seed script)',
          projectUserId: defaultUserId,
          tenancyId: internalTenancy.id,
          mirroredProjectId: 'internal',
          mirroredBranchId: 'main',
          serverMetadata: adminInternalAccess
            ? { managedProjectIds: ['internal'] }
            : undefined,
        }
      });

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
        const githubAccount = await prisma.projectUserOAuthAccount.findFirst({
          where: {
            tenancyId: internalTenancy.id,
            configOAuthProviderId: 'github',
            providerAccountId: adminGithubId,
          }
        });

        if (githubAccount) {
          console.log(`GitHub account already exists, skipping creation`);
        } else {
          await prisma.projectUserOAuthAccount.create({
            data: {
              tenancyId: internalTenancy.id,
              projectUserId: newUser.projectUserId,
              configOAuthProviderId: 'github',
              providerAccountId: adminGithubId
            }
          });

            console.log(`Added GitHub account for admin user`);
        }

        await prisma.authMethod.create({
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

  if (emulatorEnabled) {
    if (!emulatorProjectId) {
      throw new Error('STACK_EMULATOR_PROJECT_ID is not set');
    }

    const existingUser = await prisma.projectUser.findFirst({
      where: {
        mirroredProjectId: 'internal',
        mirroredBranchId: 'main',
        projectUserId: emulatorAdminUserId,
      }
    });

    if (existingUser) {
        console.log('Emulator user already exists, skipping creation');
    } else {
      const newEmulatorUser = await prisma.projectUser.create({
        data: {
          displayName: 'Local Emulator User',
          projectUserId: emulatorAdminUserId,
          tenancyId: internalTenancy.id,
          mirroredProjectId: 'internal',
          mirroredBranchId: 'main',
          serverMetadata: {
            managedProjectIds: [emulatorProjectId],
          },
        }
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

    const existingProject = await prisma.project.findUnique({
      where: {
        id: emulatorProjectId,
      },
    });

    if (existingProject) {
      console.log('Emulator project already exists, skipping creation');
    } else {
      const emulatorProject = await createOrUpdateProject({
        projectId: emulatorProjectId,
        type: 'update',
        data: {
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
        }
      });

      console.log('Created emulator project');
    }
  }

  console.log('Seeding complete!');
}

seed().catch(async (e) => {
  console.error(errorToNiceString(e));
  await prisma.$disconnect();
  process.exit(1);
// eslint-disable-next-line @typescript-eslint/no-misused-promises
}).finally(async () => await prisma.$disconnect());
