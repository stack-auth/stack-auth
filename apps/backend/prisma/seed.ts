/* eslint-disable no-restricted-syntax */
import { getSoleTenancyFromProject } from '@/lib/tenancies';
import { PrismaClient } from '@prisma/client';
import { throwErr } from '@stackframe/stack-shared/dist/utils/errors';
import { hashPassword } from "@stackframe/stack-shared/dist/utils/hashes";
import { generateUuid } from '@stackframe/stack-shared/dist/utils/uuids';

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
  const clientTeamCreation = process.env.STACK_SEED_INTERNAL_PROJECT_CLIENT_TEAM_CREATION === 'true';

  const emulatorEnabled = process.env.STACK_EMULATOR_ENABLED === 'true';
  const emulatorProjectId = process.env.STACK_EMULATOR_PROJECT_ID;

  const apiKeyId = '3142e763-b230-44b5-8636-aa62f7489c26';
  const defaultUserId = '33e7c043-d2d1-4187-acd3-f91b5ed64b46';
  const emulatorAdminUserId = '63abbc96-5329-454a-ba56-e0460173c6c1';

  let internalProject = await prisma.project.findUnique({
    where: {
      id: 'internal',
    },
    include: {
      config: true,
    }
  });

  if (!internalProject) {
    await prisma.$transaction(async (tx) => {
      internalProject = await tx.project.create({
        data: {
          id: 'internal',
          displayName: 'Stack Dashboard',
          description: 'Stack\'s admin dashboard',
          isProductionMode: false,
          tenancies: {
            create: {
              id: generateUuid(),
              branchId: 'main',
              hasNoOrganization: "TRUE",
              organizationId: null,
            }
          },
          config: {
            create: {
              allowLocalhost: true,
              emailServiceConfig: {
                create: {
                  proxiedEmailServiceConfig: {
                    create: {}
                  }
                }
              },
              createTeamOnSignUp: false,
              clientTeamCreationEnabled: clientTeamCreation,
              authMethodConfigs: {
                create: [
                  {
                    passwordConfig: {
                      create: {},
                    }
                  },
                  ...(otpEnabled ? [{
                    otpConfig: {
                      create: {
                        contactChannelType: 'EMAIL'
                      },
                    }
                  }]: []),
                ],
              },
              oauthProviderConfigs: {
                create: oauthProviderIds.map((id) => ({
                  id,
                  proxiedOAuthConfig: {
                    create: {
                      type: id.toUpperCase() as any,
                    }
                  },
                  projectUserOAuthAccounts: {
                    create: []
                  }
                })),
              },
            }
          }
        },
        include: {
          config: true,
        }
      });

      await tx.projectConfig.update({
        where: {
          id: internalProject.configId,
        },
        data: {
          authMethodConfigs: {
            create: [
              ...oauthProviderIds.map((id) => ({
                oauthProviderConfig: {
                  connect: {
                    projectConfigId_id: {
                      id,
                      projectConfigId: (internalProject as any).configId,
                    }
                  }
                }
              }))
            ],
          },
        }
      });
    });

    console.log('Internal project created');
  }

  const internalTenancy = await getSoleTenancyFromProject("internal");

  if (!internalProject) {
    throw new Error('Internal project not found');
  }

  if (internalProject.config.signUpEnabled !== signUpEnabled) {
    await prisma.projectConfig.update({
      where: {
        id: internalProject.configId,
      },
      data: {
        signUpEnabled,
      }
    });

    console.log(`Updated signUpEnabled for internal project: ${signUpEnabled}`);
  }

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
    await prisma.$transaction(async (tx) => {
      const oldAdminUser = await tx.projectUser.findFirst({
        where: {
          mirroredProjectId: 'internal',
          mirroredBranchId: 'main',
          projectUserId: defaultUserId
        }
      });

      if (oldAdminUser) {
        console.log(`Admin user already exists, skipping creation`);
      } else {
        const newUser = await tx.projectUser.create({
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
          await tx.contactChannel.create({
            data: {
              projectUserId: newUser.projectUserId,
              tenancyId: internalTenancy.id,
              type: 'EMAIL' as const,
              value: adminEmail as string,
              isVerified: false,
              isPrimary: 'TRUE',
              usedForAuth: 'TRUE',
            }
          });

          const passwordConfig = await tx.passwordAuthMethodConfig.findFirstOrThrow({
            where: {
              projectConfigId: (internalProject as any).configId
            },
            include: {
              authMethodConfig: true,
            }
          });

          await tx.authMethod.create({
            data: {
              tenancyId: internalTenancy.id,
              projectConfigId: (internalProject as any).configId,
              projectUserId: newUser.projectUserId,
              authMethodConfigId: passwordConfig.authMethodConfigId,
              passwordAuthMethod: {
                create: {
                  passwordHash: await hashPassword(adminPassword),
                  projectUserId: newUser.projectUserId,
                }
              }
            }
          });

          console.log(`Added admin user with email ${adminEmail}`);
        }

        if (adminGithubId) {
          const githubConfig = await tx.oAuthProviderConfig.findUnique({
            where: {
              projectConfigId_id: {
                projectConfigId: (internalProject as any).configId,
                id: 'github'
              }
            }
          });

          if (!githubConfig) {
            throw new Error('GitHub OAuth provider config not found');
          }

          const githubAccount = await tx.projectUserOAuthAccount.findFirst({
            where: {
              tenancyId: internalTenancy.id,
              projectConfigId: (internalProject as any).configId,
              oauthProviderConfigId: 'github',
              providerAccountId: adminGithubId,
            }
          });

          if (githubAccount) {
            console.log(`GitHub account already exists, skipping creation`);
          } else {
            await tx.projectUserOAuthAccount.create({
              data: {
                tenancyId: internalTenancy.id,
                projectConfigId: (internalProject as any).configId,
                projectUserId: newUser.projectUserId,
                oauthProviderConfigId: 'github',
                providerAccountId: adminGithubId
              }
            });

            console.log(`Added GitHub account for admin user`);
          }

          await tx.authMethod.create({
            data: {
              tenancyId: internalTenancy.id,
              projectConfigId: (internalProject as any).configId,
              projectUserId: newUser.projectUserId,
              authMethodConfigId: githubConfig.authMethodConfigId || throwErr('GitHub OAuth provider config not found'),
              oauthAuthMethod: {
                create: {
                  projectUserId: newUser.projectUserId,
                  oauthProviderConfigId: 'github',
                  providerAccountId: adminGithubId,
                  projectConfigId: (internalProject as any).configId,
                }
              }
            }
          });

          console.log(`Added admin user with GitHub ID ${adminGithubId}`);
        }
      }
    });
  }

  if (internalProject.config.allowLocalhost !== allowLocalhost) {
    console.log('Updating allowLocalhost for internal project: ', allowLocalhost);

    await prisma.project.update({
      where: { id: 'internal' },
      data: {
        config: {
          update: {
            allowLocalhost,
          }
        }
      }
    });
  }

  if (dashboardDomain) {
    const url = new URL(dashboardDomain);

    if (url.hostname !== 'localhost') {
      console.log('Adding trusted domain for internal project: ', dashboardDomain);

      await prisma.projectDomain.upsert({
        where: {
          projectConfigId_domain: {
            projectConfigId: internalProject.configId,
            domain: dashboardDomain,
          }
        },
        update: {},
        create: {
          projectConfigId: internalProject.configId,
          domain: dashboardDomain,
          handlerPath: '/',
        }
      });
    } else if (!allowLocalhost) {
      throw new Error('Cannot use localhost as a trusted domain if STACK_SEED_INTERNAL_PROJECT_ALLOW_LOCALHOST is not set to true');
    }
  }

  if (emulatorEnabled) {
    if (!emulatorProjectId) {
      throw new Error('STACK_EMULATOR_PROJECT_ID is not set');
    }

    await prisma.$transaction(async (tx) => {
      const existingUser = await tx.projectUser.findFirst({
        where: {
          mirroredProjectId: 'internal',
          mirroredBranchId: 'main',
          projectUserId: emulatorAdminUserId,
        }
      });

      if (existingUser) {
        console.log('Emulator user already exists, skipping creation');
      } else {
        const passwordConfig = await tx.authMethodConfig.findFirst({
          where: {
            projectConfigId: (internalProject as any).configId,
            passwordConfig: {
              isNot: null
            }
          },
        });

        if (!passwordConfig) {
          throw new Error('Password auth method config not found');
        }

        const newEmulatorUser = await tx.projectUser.create({
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

        await tx.contactChannel.create({
          data: {
            projectUserId: newEmulatorUser.projectUserId,
            tenancyId: internalTenancy.id,
            type: 'EMAIL' as const,
            value: 'local-emulator@stack-auth.com',
            isVerified: false,
            isPrimary: 'TRUE',
            usedForAuth: 'TRUE',
          }
        });

        await tx.authMethod.create({
          data: {
            tenancyId: internalTenancy.id,
            projectConfigId: (internalProject as any).configId,
            projectUserId: newEmulatorUser.projectUserId,
            authMethodConfigId: passwordConfig.id,
            passwordAuthMethod: {
              create: {
                passwordHash: await hashPassword('LocalEmulatorPassword'),
                projectUserId: newEmulatorUser.projectUserId,
              }
            }
          }
        });

        console.log('Created emulator user');
      }
    });

    console.log('Created emulator user');

    const existingProject = await prisma.project.findUnique({
      where: {
        id: emulatorProjectId,
      },
    });

    if (existingProject) {
      console.log('Emulator project already exists, skipping creation');
    } else {
      await prisma.$transaction(async (tx) => {
        const emulatorProject = await tx.project.create({
          data: {
            id: emulatorProjectId,
            displayName: 'Local Emulator Project',
            description: 'Project for local development with emulator',
            isProductionMode: false,
            config: {
              create: {
                allowLocalhost: true,
                emailServiceConfig: {
                  create: {
                    proxiedEmailServiceConfig: {
                      create: {}
                    }
                  }
                },
                createTeamOnSignUp: false,
                clientTeamCreationEnabled: false,
                authMethodConfigs: {
                  create: [
                    {
                      passwordConfig: {
                        create: {},
                      }
                    }
                  ],
                },
                oauthProviderConfigs: {
                  create: ['github', 'google'].map((id) => ({
                    id,
                    proxiedOAuthConfig: {
                      create: {
                        type: id.toUpperCase() as any,
                      }
                    },
                    projectUserOAuthAccounts: {
                      create: []
                    }
                  })),
                },
              },
            },
            tenancies: {
              create: {
                id: generateUuid(),
                branchId: 'main',
                hasNoOrganization: "TRUE",
                organizationId: null,
              }
            }
          }
        });

        await tx.projectConfig.update({
          where: {
            id: emulatorProject.configId,
          },
          data: {
            authMethodConfigs: {
              create: [
                ...['github', 'google'].map((id) => ({
                  oauthProviderConfig: {
                    connect: {
                      projectConfigId_id: {
                        id,
                        projectConfigId: emulatorProject.configId,
                      }
                    }
                  }
                }))
              ],
            },
          }
        });
      });

      console.log('Created emulator project');
    }
  }

  console.log('Seeding complete!');
}

seed().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
// eslint-disable-next-line @typescript-eslint/no-misused-promises
}).finally(async () => await prisma.$disconnect());
