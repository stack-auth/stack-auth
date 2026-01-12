import { EmailOutboxRecipient } from "@/lib/emails";
import { globalPrismaClient } from "@/prisma-client";

type FailedEmailsQueryResult = {
  tenancyId: string,
  projectId: string,
  to: EmailOutboxRecipient,
  subject: string | null,
  contactEmail: string,
}

type FailedEmailsByTenancyData = {
  emails: Array<{ subject: string, to: string[] }>,
  tenantOwnerEmails: string[],
  projectId: string,
}

export const getFailedEmailsByTenancy = async (after: Date) => {
  // Only email digest for hosted DB is supported for now.
  const result = await globalPrismaClient.$replica().$queryRaw<Array<FailedEmailsQueryResult>>`
  SELECT
    eo."tenancyId",
    t."projectId",
    eo."to",
    eo."renderedSubject" as "subject",
    cc."value" as "contactEmail"
  FROM "EmailOutbox" eo
  INNER JOIN "Tenancy" t ON eo."tenancyId" = t.id
  INNER JOIN "Project" p ON t."projectId" = p.id
  LEFT JOIN "ProjectUser" pu ON pu."mirroredProjectId" = 'internal'
    AND pu."mirroredBranchId" = 'main'
  INNER JOIN "Team" team ON team."teamId" = p."ownerTeamId"
  INNER JOIN "TeamMember" tm ON tm."teamId" = team."teamId"
    AND tm."projectUserId" = pu."projectUserId"
  INNER JOIN "ContactChannel" cc ON tm."projectUserId" = cc."projectUserId" 
    AND cc."isPrimary" = 'TRUE' 
    AND cc."type" = 'EMAIL'
  WHERE eo."simpleStatus" = 'ERROR'::"EmailOutboxSimpleStatus"
    AND eo."createdAt" >= ${after}
`;

  const failedEmailsByTenancy = new Map<string, FailedEmailsByTenancyData>();
  for (const failedEmail of result) {
    const failedEmails = failedEmailsByTenancy.get(failedEmail.tenancyId) ?? {
      emails: [],
      tenantOwnerEmails: [],
      projectId: failedEmail.projectId
    };

    let to: string[] = [];
    const recipient = failedEmail.to;
    switch (recipient.type) {
      case 'user-primary-email': {
        to = [`User ID: ${recipient.userId}`];
        break;
      }
      case 'user-custom-emails': {
        to = Array.isArray(recipient.emails) ? recipient.emails : [];
        break;
      }
      case 'custom-emails': {
        to = Array.isArray(recipient.emails) ? recipient.emails : [];
        break;
      }
    }

    failedEmails.emails.push({ subject: failedEmail.subject ?? "(No Subject)", to });
    failedEmails.tenantOwnerEmails.push(failedEmail.contactEmail);  // TODO: this needs some deduplication
    failedEmailsByTenancy.set(failedEmail.tenancyId, failedEmails);
  }
  return failedEmailsByTenancy;
};
