import { getSharedEmailConfig, sendEmail } from "@/lib/emails";
import { listPermissions } from "@/lib/permissions";
import { getTenancy } from "@/lib/tenancies";
import { getPrismaClientForTenancy, globalPrismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { escapeHtml } from "@stackframe/stack-shared/dist/utils/html";

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Revoke an API key",
    description: "Revoke an API key that was found through credential scanning",
    tags: ["Credential Scanning"],
    hidden: true,
  },
  request: yupObject({
    body: yupObject({
      api_key: yupString().defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["success"]).defined(),
  }),
  async handler({ body }) {
    // Get the API key and revoke it. We use a transaction to ensure we do not send emails multiple times.
    // We don't support revoking API keys in tenancies with non-global source of truth atm.
    const updatedApiKey = await globalPrismaClient.$transaction(async (tx) => {
      // Find the API key in the database
      const apiKey = await tx.projectApiKey.findUnique({
        where: {
          secretApiKey: body.api_key,
        }
      });

      if (!apiKey) {
        throw new KnownErrors.ApiKeyNotFound();
      }

      if (apiKey.isPublic) {
        throw new KnownErrors.PublicApiKeyCannotBeRevoked();
      }

      if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
        throw new KnownErrors.ApiKeyExpired();
      }

      if (apiKey.manuallyRevokedAt) {
        return null;
      }

      // Revoke the API key
      await tx.projectApiKey.update({
        where: {
          tenancyId_id: {
            tenancyId: apiKey.tenancyId,
            id: apiKey.id,
          },
        },
        data: {
          manuallyRevokedAt: new Date(),
        },
      });

      return apiKey;
    });

    if (!updatedApiKey) {
      return {
        statusCode: 200,
        bodyType: "success",
      };
    }

    // Get affected users and their emails
    const affectedEmails = new Set<string>();

    if (updatedApiKey.projectUserId) {
      // For user API keys, notify the user
      const tenancy = await getTenancy(updatedApiKey.tenancyId);
      if (!tenancy) {
        throw new StackAssertionError("Tenancy not found");
      }

      const prisma = await getPrismaClientForTenancy(tenancy);
      const projectUser = await prisma.projectUser.findUnique({
        where: {
          tenancyId_projectUserId: {
            tenancyId: updatedApiKey.tenancyId,
            projectUserId: updatedApiKey.projectUserId,
          },
        },
        include: {
          contactChannels: true,
        },
      });

      if (!projectUser) {
        // This should never happen
        throw new StackAssertionError("Project user not found");
      }
      // We might have other types besides email, so we disable this rule
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      const primaryEmail = projectUser.contactChannels.find(c => c.type === 'EMAIL' && c.isPrimary)?.value ?? undefined;
      if (primaryEmail) {
        affectedEmails.add(primaryEmail);
      }
    } else if (updatedApiKey.teamId) {
      // For team API keys, notify users with manage_api_keys permission
      const tenancy = await getTenancy(updatedApiKey.tenancyId);
      if (!tenancy) {
        throw new StackAssertionError("Tenancy not found");
      }

      const prisma = await getPrismaClientForTenancy(tenancy);

      const userIdsWithManageApiKeysPermission = await prisma.$transaction(async (tx) => {
        if (!updatedApiKey.teamId) {
          throw new StackAssertionError("Team ID not specified in team API key");
        }

        const permissions = await listPermissions(tx, {
          scope: 'team',
          tenancy,
          teamId: updatedApiKey.teamId,
          permissionId: '$manage_api_keys',
          recursive: true,
        });

        return permissions.map(p => p.user_id);
      });

      const usersWithManageApiKeysPermission = await prisma.projectUser.findMany({
        where: {
          tenancyId: updatedApiKey.tenancyId,
          projectUserId: {
            in: userIdsWithManageApiKeysPermission,
          },
        },
        include: {
          contactChannels: true,
        },
      });

      for (const user of usersWithManageApiKeysPermission) {
        // We might have other types besides email, so we disable this rule
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        const primaryEmail = user.contactChannels.find(c => c.type === 'EMAIL' && c.isPrimary)?.value ?? undefined;
        if (primaryEmail) {
            affectedEmails.add(primaryEmail);
        }
      }
    }

    const tenancy = await globalPrismaClient.tenancy.findUnique({
      where: {
        id: updatedApiKey.tenancyId
      },
      include: {
        project: true,
      },
    });

    if (!tenancy) {
      throw new StackAssertionError("Tenancy not found");
    }

    // Create email content
    const subject = `API Key Revoked: ${updatedApiKey.description}`;
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #333;">API Key Revoked</h2>
        <p style="color: #555; font-size: 16px; line-height: 1.5;">
          Your API key "${escapeHtml(updatedApiKey.description)}" for ${escapeHtml(tenancy.project.displayName)} has been automatically revoked because it was found in a public repository.
        </p>
        <p style="color: #555; font-size: 16px; line-height: 1.5;">
          This is an automated security measure to protect your api keys from being leaked. If you believe this was a mistake, please contact support.
        </p>
        <p style="color: #555; font-size: 16px; line-height: 1.5;">
          Please create a new API key if needed.
        </p>
      </div>
    `;

    const emailConfig = await getSharedEmailConfig("Stack Auth");

    // Send email notifications
    for (const email of affectedEmails) {
      await sendEmail({
        tenancyId: updatedApiKey.tenancyId,
        emailConfig,
        to: email,
        subject,
        html: htmlContent,
      });
    }

    return {
      statusCode: 200,
      bodyType: "success",
    };
  },
});
