import { prismaClient } from "@/prisma-client";

type FailedEmailsQueryResult = {
  tenancyId: string,
  projectId: string,
  to: string[],
  subject: string,
  contactEmail: string,
}

type FailedEmailsByTenancyData = {
  emails: Array<{ subject: string, to: string[] }>,
  tenantOwnerEmail: string,
  projectId: string,
}

export const getFailedEmailsByTenancy = async (after: Date) => {
  const result = await prismaClient.$queryRaw<Array<FailedEmailsQueryResult>>`
  SELECT
    se."tenancyId",
    t."projectId",
    se."to",
    se."subject",
    cc."value" as "contactEmail"
  FROM "SentEmail" se
  INNER JOIN "Tenancy" t ON se."tenancyId" = t.id
  LEFT JOIN "ProjectUser" pu ON pu."mirroredProjectId" = 'internal'
    AND pu."mirroredBranchId" = 'main'
    AND pu."serverMetadata"->'managedProjectIds' ? t."projectId"
  LEFT JOIN "ContactChannel" cc ON pu."projectUserId" = cc."projectUserId" 
    AND cc."isPrimary" = 'TRUE' 
    AND cc."type" = 'EMAIL'
  WHERE se."error" IS NOT NULL
    AND se."createdAt" >= ${after}
`;

  const failedEmailsByTenancy = new Map<string, FailedEmailsByTenancyData>();
  for (const failedEmail of result) {
    let failedEmails = failedEmailsByTenancy.get(failedEmail.tenancyId) ?? {
      emails: [],
      tenantOwnerEmail: failedEmail.contactEmail,
      projectId: failedEmail.projectId
    };
   failedEmails.emails.push({ subject: failedEmail.subject, to: failedEmail.to });
   failedEmailsByTenancy.set(failedEmail.tenancyId, failedEmails);
  }
  return failedEmailsByTenancy;
};
