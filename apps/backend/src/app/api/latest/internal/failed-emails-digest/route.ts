import { getSharedEmailConfig, sendEmail } from "@/lib/emails";
import { DEFAULT_BRANCH_ID, getSoleTenancyFromProjectBranch } from "@/lib/tenancies";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { yupArray, yupBoolean, yupNumber, yupObject, yupString, yupTuple } from "@stackframe/stack-shared/dist/schema-fields";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { getFailedEmailsByTenancy } from "./crud";

export const POST = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    headers: yupObject({
      "authorization": yupTuple([yupString()]).defined(),
    }),
    method: yupString().oneOf(["POST"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200, 401]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      success: yupBoolean().defined(),
      error_message: yupString().optional(),
      failed_emails_by_tenancy: yupArray(yupObject({
        emails: yupArray(yupObject({
          subject: yupString().defined(),
          to: yupArray(yupString().defined()).defined(),
        })).defined(),
        tenant_owner_email: yupString().defined(),
        project_id: yupString().defined(),
        tenancy_id: yupString().defined(),
      })).optional(),
    }).defined(),
  }),
  handler: async ({ headers }) => {
    const authHeader = headers.authorization[0];
    if (authHeader !== `Bearer ${getEnvVariable('STACK_CRON_SECRET')}`) {
      throw new StatusError(401, "Unauthorized");
    }

    const failedEmailsByTenancy = await getFailedEmailsByTenancy(new Date(Date.now() - 1000 * 60 * 60 * 24));
    const internalTenancy = await getSoleTenancyFromProjectBranch("internal", DEFAULT_BRANCH_ID);
    const emailConfig = await getSharedEmailConfig("Stack Auth");
    const dashboardUrl = getEnvVariable("NEXT_PUBLIC_STACK_DASHBOARD_URL", "https://app.stack-auth.com");

    for (const failedEmailsBatch of failedEmailsByTenancy.values()) {
      const viewInStackAuth = `<a href="${dashboardUrl}/projects/${failedEmailsBatch.projectId}/emails">View all email logs on the Dashboard</a>`;
      const emailHtml = `
        <p>You have ${failedEmailsBatch.emails.length} emails that failed to be sent in the last 24 hours. Please check your email server configuration.</p>
        <p>${viewInStackAuth}</p>
        <p>Last failing emails:</p>
        ${failedEmailsBatch.emails.slice(-10).map(
          (failedEmail) => `<div><p>Subject: ${failedEmail.subject}<br />To: ${failedEmail.to.join(", ")}</p></div>`
        ).join("")}
        ${failedEmailsBatch.emails.length > 10 ? `<div>...</div>` : ""}
      `;
      await sendEmail({
        tenancyId: internalTenancy.id,
        emailConfig,
        to: failedEmailsBatch.tenantOwnerEmail,
        subject: "Failed emails digest",
        html: emailHtml,
      });
    }

    return {
      statusCode: 200,
      bodyType: 'json',
      body: {
        success: true,
        failed_emails_by_tenancy: Array.from(failedEmailsByTenancy.entries()).map(([tenancyId, batch]) => (
          {
            emails: batch.emails,
            tenant_owner_email: batch.tenantOwnerEmail,
            project_id: batch.projectId,
            tenancy_id: tenancyId,
          }
        ),
        )
      },
    };
  },
});
