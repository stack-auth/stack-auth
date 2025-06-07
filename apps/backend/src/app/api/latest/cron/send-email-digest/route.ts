import { getEmailConfig, sendEmail } from "@/lib/emails";
import { getSoleTenancyFromProject } from "@/lib/tenancies";
import { prismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { Prisma, Project } from "@prisma/client";
import { yupBoolean, yupNumber, yupObject, yupString, yupTuple } from "@stackframe/stack-shared/dist/schema-fields";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";

export const GET = createSmartRouteHandler({
  metadata: {
    summary: "Send email digest",
    description: "Sends a digest of failed emails to project owners",
    tags: ["cron"],
  },
  request: yupObject({
    auth: yupObject({}).nullable(),
    query: yupObject({}),
    headers: yupObject({
      authorization: yupTuple([yupString().defined()]).defined(),
    }),
    method: yupString().oneOf(["GET"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      success: yupBoolean().defined(),
    }),
  }),
  handler: async (req) => {
    const authHeader = req.headers.authorization[0];
    const cronSecret = getEnvVariable('CRON_SECRET');

    if (authHeader !== `Bearer ${cronSecret}`) {
      throw new StatusError(401, 'Unauthorized');
    }

    // get projects from tenancy IDs
    const emails = await prismaClient.sentEmail.findMany({
      where: {
        createdAt: {
          gte: new Date(Date.now() - 1000 * 60 * 60 * 24),
        },
        error: {
          not: Prisma.AnyNull,
        }
      },
      include: {
        tenancy: {
          include: {
            project: true,
          }
        },
      }
    });

    const projectWithEmails = new Map<string, { project: Project, emails: (typeof emails)[number][] }>();

    // dedupe by project
    for (const email of emails) {
      const projectId = email.tenancy.project.id;
      if (!projectWithEmails.has(projectId)) {
        projectWithEmails.set(projectId, {
          project: email.tenancy.project,
          emails: [],
        });
      }
      projectWithEmails.get(projectId)!.emails.push(email);
    }

    const usersBase = await Promise.all(Array.from(projectWithEmails.keys()).map(async (projectId) => {
      return await prismaClient.projectUser.findMany({
        where: {
          mirroredProjectId: {
            equals: 'internal',
          },
          serverMetadata: {
            path: ['managedProjectIds'],
            array_contains: projectId,
          }
        },
        include: {
          contactChannels: {
            where: {
              isPrimary: "TRUE",
            }
          },
        }
      });
    }));

    const internal = await getSoleTenancyFromProject('internal');
    const emailConfig = await getEmailConfig(internal);

    await Promise.all(usersBase.flat().map(async (user) => {
      if (user.contactChannels.length === 0) {
        return;
      }
      const contactChannel = user.contactChannels[0];

      for (const projectId of ((user.serverMetadata as any).managedProjectIds ?? []) as string[]) {
        const emails = projectWithEmails.get(projectId)?.emails ?? [];
        if (emails.length > 0) {
          const failedRecipients = emails.flatMap(email => email.to);

          await sendEmail({
            tenancyId: internal.id,
            to: contactChannel.value,
            subject: `You have ${emails.length} emails that failed to deliver in your project ${projectWithEmails.get(projectId)?.project.displayName}`,
            text: `The following email addresses failed to receive messages:\n\n${failedRecipients.join('\n')}`,
            emailConfig,
          });
        }
      }
    }));

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        success: true,
      },
    };
  },
});
