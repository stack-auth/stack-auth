import { prismaClient, retryTransaction } from "@/prisma-client";
import { createCrudHandlers } from "@/route-handlers/crud-handler";
import { OrganizationConfigOverride, OrganizationRenderedConfig } from "@stackframe/stack-shared/dist/config/schema";
import { projectsCrud } from "@stackframe/stack-shared/dist/interface/crud/projects";
import { yupObject } from "@stackframe/stack-shared/dist/schema-fields";
import { typedEntries } from "@stackframe/stack-shared/dist/utils/objects";
import { createLazyProxy } from "@stackframe/stack-shared/dist/utils/proxies";
import { randomUUID } from "crypto";

export const projectsCrudHandlers = createLazyProxy(() => createCrudHandlers(projectsCrud, {
  paramsSchema: yupObject({}),
  onUpdate: async ({ auth, data }) => {
    const oldConfigOverride = null as unknown as OrganizationRenderedConfig;
    const configOverride: OrganizationConfigOverride = {};

    // ======================= auth =======================

    if (data.config?.sign_up_enabled !== undefined) {
      configOverride['auth.allowSignUp'] = data.config.sign_up_enabled;
    }

    if (data.config?.credential_enabled !== undefined) {
      configOverride['auth.password.allowSignIn'] = data.config.credential_enabled;
    }

    if (data.config?.magic_link_enabled !== undefined) {
      configOverride['auth.otp.allowSignIn'] = data.config.magic_link_enabled;
    }

    if (data.config?.passkey_enabled !== undefined) {
      configOverride['auth.passkey.allowSignIn'] = data.config.passkey_enabled;
    }

    if (data.config?.oauth_account_merge_strategy !== undefined) {
      configOverride['auth.oauth.accountMergeStrategy'] = data.config.oauth_account_merge_strategy;
    }

    if (data.config?.oauth_providers) {
      for (const provider of data.config.oauth_providers) {
        if (provider.enabled) {
          configOverride[`auth.oauth.providers.${provider.id}`] = {
            type: provider.id,
            allowSignIn: true,
            allowConnectedAccounts: true,
          } satisfies OrganizationRenderedConfig['auth']['oauth']['providers'][string];
        }
      }

      for (const [id, _] of typedEntries(oldConfigOverride.auth.oauth.providers)) {
        if (!data.config.oauth_providers.find((p) => p.id === id)) {
          delete configOverride[`auth.oauth.providers.${id}`];
        }
      }
    }

    // ======================= users =======================

    if (data.config?.client_user_deletion_enabled !== undefined) {
      configOverride['users.allowClientUserDeletion'] = data.config.client_user_deletion_enabled;
    }

    // ======================= teams =======================

    if (data.config?.client_team_creation_enabled !== undefined) {
      configOverride['teams.allowClientTeamCreation'] = data.config.client_team_creation_enabled;
    }

    if (data.config?.create_team_on_sign_up !== undefined) {
      configOverride['teams.createPersonalTeamOnSignUp'] = data.config.create_team_on_sign_up;
    }

    // ======================= domains =======================

    if (data.config?.allow_localhost !== undefined) {
      configOverride['domains.allowLocalhost'] = data.config.allow_localhost;
    }

    const domains = data.config?.domains;
    if (domains) {
      for (const [id, domain] of typedEntries(oldConfigOverride.domains.trustedDomains)) {
        const newDomain = domains.find((d) => d.domain === domain.baseUrl);
        if (newDomain) {
          configOverride[`domains.trustedDomains.${id}`] = {
            baseUrl: newDomain.domain,
            handlerPath: newDomain.handler_path,
          } satisfies OrganizationRenderedConfig['domains']['trustedDomains'][string];
        } else {
          delete configOverride[`domains.trustedDomains.${id}`];
        }
      }

      for (const domain of domains) {
        if (!typedEntries(oldConfigOverride.domains.trustedDomains).map(([_, d]) => d.baseUrl).includes(domain.domain)) {
          configOverride[`domains.trustedDomains.${randomUUID()}`] = {
            baseUrl: domain.domain,
            handlerPath: domain.handler_path,
          } satisfies OrganizationRenderedConfig['domains']['trustedDomains'][string];
        }
      }
    }


    // ======================= api keys =======================

    if (data.config?.allow_user_api_keys !== undefined) {
      configOverride['apiKeys.enabled.user'] = data.config.allow_user_api_keys;
    }

    if (data.config?.allow_team_api_keys !== undefined) {
      configOverride['apiKeys.enabled.team'] = data.config.allow_team_api_keys;
    }

    // ======================= emails =======================

    if (data.config?.email_config) {
      configOverride['emails.emailServer'] = {
        isShared: data.config.email_config.type === 'shared',
        host: data.config.email_config.host,
        port: data.config.email_config.port,
        username: data.config.email_config.username,
        password: data.config.email_config.password,
        senderName: data.config.email_config.sender_name,
        senderEmail: data.config.email_config.sender_email,
      } satisfies OrganizationRenderedConfig['emails']['server'];
    }


  },
  onRead: async ({ auth }) => {
    return auth.project;
  },
  onDelete: async ({ auth }) => {
    await retryTransaction(async (tx) => {
      await prismaClient.project.delete({
        where: {
          id: auth.project.id
        }
      });

      // delete managed ids from users
      const users = await tx.projectUser.findMany({
        where: {
          mirroredProjectId: 'internal',
          serverMetadata: {
            path: ['managedProjectIds'],
            array_contains: auth.project.id
          }
        }
      });

      for (const user of users) {
        const updatedManagedProjectIds = (user.serverMetadata as any).managedProjectIds.filter(
          (id: any) => id !== auth.project.id
        ) as string[];

        await tx.projectUser.update({
          where: {
            mirroredProjectId_mirroredBranchId_projectUserId: {
              mirroredProjectId: 'internal',
              mirroredBranchId: user.mirroredBranchId,
              projectUserId: user.projectUserId
            }
          },
          data: {
            serverMetadata: {
              ...user.serverMetadata as any,
              managedProjectIds: updatedManagedProjectIds,
            }
          }
        });
      }
    });
  }
}));
