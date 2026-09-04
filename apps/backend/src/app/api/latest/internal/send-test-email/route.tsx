import { LowLevelEmailConfig, isSecureEmailPort, lowLevelSendEmailDirectWithoutRetries, resolveHttpProviderBaseUrl } from "@/lib/emails-low-level";
import { arePlanLimitsEnforced, getBillingTeamId } from "@/lib/plan-entitlements";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { getHexclaveServerApp } from "@/hexclave";
import { KnownErrors } from "@hexclave/shared";
import { ITEM_IDS } from "@hexclave/shared/dist/plans";
import * as schemaFields from "@hexclave/shared/dist/schema-fields";
import { adaptSchema, adminAuthTypeSchema, emailSchema, yupBoolean, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { HexclaveAssertionError, captureError, throwErr } from "@hexclave/shared/dist/utils/errors";
import { timeout } from "@hexclave/shared/dist/utils/promises";
import { Result } from "@hexclave/shared/dist/utils/results";

export const POST = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema,
      tenancy: adaptSchema.defined(),
    }).defined(),
    body: yupObject({
      recipient_email: emailSchema.defined(),
      email_config: yupObject({
        // Clients that predate the HTTP transport (including older SDK versions) send only SMTP
        // credentials and no discriminator, so `type` defaults to 'standard' instead of being
        // required — otherwise every existing sendTestEmail() call would start failing validation.
        type: yupString().oneOf(["standard", "http"]).optional().default("standard"),
        host: schemaFields.yupDefinedAndNonEmptyWhen(schemaFields.emailHostSchema, { type: "standard" }),
        port: schemaFields.yupDefinedWhen(schemaFields.emailPortSchema, { type: "standard" }),
        username: schemaFields.yupDefinedAndNonEmptyWhen(schemaFields.emailUsernameSchema, { type: "standard" }),
        password: schemaFields.yupDefinedAndNonEmptyWhen(schemaFields.emailPasswordSchema, { type: "standard" }),
        email_provider: schemaFields.yupDefinedAndNonEmptyWhen(schemaFields.emailProviderSchema, { type: "http" }),
        api_key: schemaFields.yupDefinedAndNonEmptyWhen(schemaFields.emailApiKeySchema, { type: "http" }),
        base_url: schemaFields.emailBaseUrlSchema.optional(),
        sender_name: schemaFields.emailSenderNameSchema.defined(),
        sender_email: schemaFields.emailSenderEmailSchema.defined(),
      }).defined(),
    }).defined(),
    method: yupString().oneOf(["POST"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      success: yupBoolean().defined(),
      error_message: yupString().optional(),
    }).defined(),
  }),
  handler: async ({ body, auth }) => {
    // Debit the emails_per_month quota before hitting SMTP so this endpoint
    // can't be used as an unbounded SMTP-send-through / socket-exhaustion
    // vector (admin provides arbitrary recipient_email and email_config, so
    // without a quota guard even a compromised/hostile project admin could
    // spam an arbitrary recipient or pin our event loop with 10s SMTP waits).
    // The debit is refunded on any failure below so admins iterating on an
    // incorrect SMTP config don't burn through their monthly quota.
    const billingTeamId = getBillingTeamId(auth.tenancy.project);
    const emailItem = billingTeamId == null || !arePlanLimitsEnforced()
      ? null
      : await getHexclaveServerApp().getItem({ itemId: ITEM_IDS.emailsPerMonth, teamId: billingTeamId });
    if (emailItem != null && billingTeamId != null) {
      const isDebited = await emailItem.tryDecreaseQuantity(1);
      if (!isDebited) {
        throw new KnownErrors.ItemQuantityInsufficientAmount(ITEM_IDS.emailsPerMonth, billingTeamId, 1);
      }
    }

    // Built here rather than inline so both transports go through the same send, timeout, quota
    // refund and error-mapping path below. `type: 'standard'` on the low-level config marks the
    // credentials as tenant-owned for both transports, which is what makes the HTTP egress policy
    // apply to the base URL the admin just typed in.
    const emailConfig: LowLevelEmailConfig = body.email_config.type === "http" ? (() => {
      const provider = body.email_config.email_provider ?? throwErr("email_provider is required when email_config.type is 'http'; the request schema should have rejected this");
      const baseUrl = resolveHttpProviderBaseUrl(provider, body.email_config.base_url)
        ?? throwErr(`No base URL was given for the ${provider} email provider, and it has no public default`);
      return {
        transport: 'http',
        type: 'standard',
        provider,
        apiKey: body.email_config.api_key ?? throwErr("api_key is required when email_config.type is 'http'; the request schema should have rejected this"),
        baseUrl,
        senderEmail: body.email_config.sender_email,
        senderName: body.email_config.sender_name,
      };
    })() : {
      transport: 'smtp',
      type: 'standard',
      host: body.email_config.host ?? throwErr("host is required when email_config.type is 'standard'; the request schema should have rejected this"),
      port: body.email_config.port ?? throwErr("port is required when email_config.type is 'standard'; the request schema should have rejected this"),
      username: body.email_config.username ?? throwErr("username is required when email_config.type is 'standard'; the request schema should have rejected this"),
      password: body.email_config.password ?? throwErr("password is required when email_config.type is 'standard'; the request schema should have rejected this"),
      senderEmail: body.email_config.sender_email,
      senderName: body.email_config.sender_name,
      secure: isSecureEmailPort(body.email_config.port ?? throwErr("port is required when email_config.type is 'standard'; the request schema should have rejected this")),
    };

    const resultOuter = await timeout(lowLevelSendEmailDirectWithoutRetries({
      tenancyId: auth.tenancy.id,
      emailConfig,
      to: body.recipient_email,
      subject: "Test Email from Hexclave",
      text: "This is a test email from Hexclave. If you successfully received this email, your email server configuration is working correctly.",
    }), 10000);


    const result = resultOuter.status === 'ok' ? resultOuter.data : Result.error({
      errorType: undefined,
      rawError: undefined,
      message: "Timed out while sending test email. Make sure the email server is running and accepting connections.",
    });

    let errorMessage = result.status === 'error' ? result.error.message : undefined;

    if (result.status === 'error' && result.error.errorType === 'UNKNOWN') {
      if (result.error.rawError.message && result.error.rawError.message.includes("ETIMEDOUT")) {
        errorMessage = "Timed out. Make sure the email server is running and accepting connections.";
      } else if (result.error.rawError.code === "EMESSAGE") {
        errorMessage = "Email server rejected the email: " + result.error.rawError.message;
      } else {
        captureError("send-test-email", new HexclaveAssertionError("Unknown error while sending test email. We should add a better error description for the user.", {
          cause: result.error,
          recipient_email: body.recipient_email,
          // Deliberately not the raw body: it carries the SMTP password / provider API key the
          // admin just typed, and error reports are forwarded off-box.
          email_config: { ...body.email_config, password: undefined, api_key: undefined },
        }));
        errorMessage = "Unknown error while sending test email. Make sure the email server is running and accepting connections.";
      }
    }

    // Refund the quota if we never actually delivered to SMTP — admins
    // iterating on a misconfigured mail server shouldn't burn through
    // their monthly allowance. Spam prevention is preserved because a
    // successful delivery still consumes 1 from the debit above.
    if (result.status === 'error' && emailItem != null) {
      await emailItem.increaseQuantity(1);
    }

    return {
      statusCode: 200,
      bodyType: 'json',
      body: {
        success: result.status === 'ok',
        error_message: errorMessage,
      },
    };
  },
});
