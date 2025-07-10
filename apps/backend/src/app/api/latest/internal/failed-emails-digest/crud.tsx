import { globalPrismaClient } from "@/prisma-client";

type FailedEmailsQueryResult = {
  tenancyId: string,
  projectId: string,
  to: string[],
  subject: string,
  contactEmail: string,
}

type FailedEmailsByTenancyData = {
  emails: Array<{ subject: string, to: string[] }>,
  tenantOwnerEmails: string[],
  projectId: string,
}

export const getFailedEmailsByTenancy = async (after: Date) => {
  // Only email digest for hosted DB is supported for now.
  const result = await globalPrismaClient.$queryRaw<Array<FailedEmailsQueryResult>>`
  SELECT
    se."tenancyId",
    t."projectId",
    se."to",
    se."subject",
    cc."value" as "contactEmail"
  FROM "SentEmail" se
  INNER JOIN "Tenancy" t ON se."tenancyId" = t.id
  INNER JOIN "Project" p ON t."projectId" = p.id
  LEFT JOIN "ProjectUser" pu ON pu."mirroredProjectId" = 'internal'
    AND pu."mirroredBranchId" = 'main'
    AND pu."serverMetadata"->'managedProjectIds' ? t."projectId"
  INNER JOIN "ContactChannel" cc ON pu."projectUserId" = cc."projectUserId" 
    AND cc."isPrimary" = 'TRUE' 
    AND cc."type" = 'EMAIL'
  WHERE se."error" IS NOT NULL
    AND se."createdAt" >= ${after}
`;

  const failedEmailsByTenancy = new Map<string, FailedEmailsByTenancyData>();
  for (const failedEmail of result) {
    const failedEmails = failedEmailsByTenancy.get(failedEmail.tenancyId) ?? {
      emails: [],
      tenantOwnerEmails: [],
      projectId: failedEmail.projectId
    };
    failedEmails.emails.push({ subject: failedEmail.subject, to: failedEmail.to });
    failedEmails.tenantOwnerEmails.push(failedEmail.contactEmail);
    failedEmailsByTenancy.set(failedEmail.tenancyId, failedEmails);
  }
  return failedEmailsByTenancy;
};
