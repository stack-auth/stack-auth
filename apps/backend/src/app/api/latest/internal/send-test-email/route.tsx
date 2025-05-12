import { isSecureEmailPort, sendEmailWithoutRetries } from "@/lib/emails";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import * as schemaFields from "@stackframe/stack-shared/dist/schema-fields";
import { adaptSchema, adminAuthTypeSchema, emailSchema, yupBoolean, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StackAssertionError, captureError } from "@stackframe/stack-shared/dist/utils/errors";
import { timeout } from "@stackframe/stack-shared/dist/utils/promises";
import { Result } from "@stackframe/stack-shared/dist/utils/results";

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
        host: schemaFields.emailHostSchema.defined(),
        port: schemaFields.emailPortSchema.defined(),
        username: schemaFields.emailUsernameSchema.defined(),
        password: schemaFields.emailPasswordSchema.defined(),
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
    const resultOuter = await timeout(sendEmailWithoutRetries({
      tenancyId: auth.tenancy.id,
      emailConfig: {
        type: 'standard',
        host: body.email_config.host,
        port: body.email_config.port,
        username: body.email_config.username,
        password: body.email_config.password,
        senderEmail: body.email_config.sender_email,
        senderName: body.email_config.sender_name,
        secure: isSecureEmailPort(body.email_config.port),
      },
      to: body.recipient_email,
      subject: "Test Email from Stack Auth",
      text: "This is a test email from Stack Auth. If you successfully received this email, your email server configuration is working correctly.",
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
        captureError("send-test-email", new StackAssertionError("Unknown error while sending test email. We should add a better error description for the user.", {
          cause: result.error,
          recipient_email: body.recipient_email,
          email_config: body.email_config,
        }));
        errorMessage = "Unknown error while sending test email. Make sure the email server is running and accepting connections.";
      }
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
