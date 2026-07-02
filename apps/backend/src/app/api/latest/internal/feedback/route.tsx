import { createConversation } from "@/lib/conversations";
import { sendSupportFeedbackEmail } from "@/lib/internal-feedback-emails";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { DEFAULT_BRANCH_ID, getSoleTenancyFromProjectBranch } from "@/lib/tenancies";
import { adaptSchema, emailSchema, yupBoolean, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

/**
 * Unified feedback endpoint used by both the dashboard and the dev tool.
 *
 * Auth is optional: when the user is signed in (dashboard), user info is
 * included in the email. When unauthenticated (dev tool), feedback is sent
 * without user context.
 */
export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Submit support feedback",
    description: "Send a support feedback message to the internal Hexclave inbox. Auth is optional — works from both the dashboard (authenticated) and the dev tool (unauthenticated).",
    tags: ["Internal"],
  },
  request: yupObject({
    auth: yupObject({
      tenancy: adaptSchema.optional(),
      user: adaptSchema.optional(),
    }).nullable().optional(),
    body: yupObject({
      name: yupString().optional().max(100),
      email: emailSchema.defined().nonEmpty(),
      message: yupString().defined().nonEmpty().max(5000),
      feedback_type: yupString().oneOf(["feedback", "bug"]).optional(),
    }).defined(),
    method: yupString().oneOf(["POST"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      success: yupBoolean().oneOf([true]).defined(),
    }).defined(),
  }),
  async handler({ auth, body }) {
    // Use the authenticated tenancy if available, otherwise fall back to the
    // internal project tenancy (for unauthenticated dev tool submissions).
    const tenancy = auth?.tenancy ?? await getSoleTenancyFromProjectBranch("internal", DEFAULT_BRANCH_ID);

    await sendSupportFeedbackEmail({
      tenancy,
      user: auth?.user ?? null,
      name: body.name ?? null,
      email: body.email,
      message: body.message,
      feedbackType: body.feedback_type,
    });

    // Dogfood: mirror dashboard support submissions into the managed inbox (same subject line as email).
    // If the mirror write fails the user will see a 500 and retry; duplicate emails are preferable to
    // silently swallowing a real failure (per AGENTS.md: never catch-all).
    if (auth?.tenancy != null && auth.user != null) {
      const feedbackLabel = body.feedback_type === "bug" ? "Bug Report" : "Support";
      const conversationSubject = `[${feedbackLabel}] ${body.email}`;
      await createConversation({
        tenancyId: auth.tenancy.id,
        userId: auth.user.id,
        subject: conversationSubject,
        priority: "normal",
        source: "api",
        channelType: "api",
        adapterKey: "dashboard-support-form",
        body: body.message,
        sender: {
          type: "user",
          id: auth.user.id,
          displayName: auth.user.display_name ?? null,
          primaryEmail: auth.user.primary_email ?? null,
        },
      });
    }

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        success: true,
      },
    };
  },
});
