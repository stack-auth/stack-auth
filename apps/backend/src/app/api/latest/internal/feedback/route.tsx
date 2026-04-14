import { sendSupportFeedbackEmail } from "@/lib/internal-feedback-emails";
import { isLocalEmulatorEnabled } from "@/lib/local-emulator";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { DEFAULT_BRANCH_ID, getSoleTenancyFromProjectBranch } from "@/lib/tenancies";
import { adaptSchema, emailSchema, yupBoolean, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";

/**
 * Unified feedback endpoint used by both the dashboard and the dev tool.
 *
 * Auth is optional: when the user is signed in (dashboard), user info is
 * included in the email. When unauthenticated (dev tool), feedback is sent
 * without user context.
 *
 * In the local emulator, feedback is forwarded to production Stack Auth (same
 * pattern as the AI query endpoint). Set STACK_FEEDBACK_MODE=FORWARD_TO_PRODUCTION
 * in .env.development to enable this.
 */
export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Submit support feedback",
    description: "Send a support feedback message to the internal Stack Auth inbox. Auth is optional — works from both the dashboard (authenticated) and the dev tool (unauthenticated).",
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
    // Forward to production in local emulator (same pattern as AI query endpoint)
    const feedbackMode = getEnvVariable("STACK_FEEDBACK_MODE", "email");
    if (feedbackMode === "FORWARD_TO_PRODUCTION" && isLocalEmulatorEnabled()) {
      const prodResponse = await fetch("https://api.stack-auth.com/api/latest/internal/feedback", {
        method: "POST",
        headers: { "content-type": "application/json", "accept-encoding": "identity" },
        body: JSON.stringify(body),
      });
      if (!prodResponse.ok) {
        throw new StatusError(prodResponse.status, "Failed to forward feedback to production");
      }
      return {
        statusCode: 200,
        bodyType: "json" as const,
        body: { success: true as const },
      };
    }

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

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        success: true,
      },
    };
  },
});
