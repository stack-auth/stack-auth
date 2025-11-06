import { getSvixClient } from "@/lib/webhooks";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, adminAuthTypeSchema, yupBoolean, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { captureError, StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import { MessageStatus } from "svix";

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
      endpoint_id: yupString().defined(),
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
  handler: async ({ auth, body }) => {
    const projectId = auth.tenancy.project.id;
    const svix = getSvixClient();

    await svix.application.getOrCreate({ uid: projectId, name: projectId });
    const endpointResult = await Result.fromPromise(svix.endpoint.get(projectId, body.endpoint_id));
    if (endpointResult.status === "error") {
      return {
        statusCode: 200,
        bodyType: "json",
        body: {
          success: false,
          error_message: "Endpoint not found. Make sure it still exists.",
        },
      };
    }
    const endpoint = endpointResult.data;

    const messageResult = await Result.fromPromise(svix.message.create(
      projectId,
      {
        eventType: "stack.test",
        payload: {
          type: "stack.test",
          data: {
            message: "Stack webhook test event triggered from the Stack dashboard.",
            endpointUrl: endpoint.url,
          },
        },
      },
    ));
    if (messageResult.status === "error") {
      const errorMessage = messageResult.error instanceof Error ? messageResult.error.message : "Unknown error while sending the test webhook.";
      captureError("send-test-webhook", new StackAssertionError("Failed to send test webhook", {
        cause: messageResult.error,
        project_id: projectId,
        endpoint_id: body.endpoint_id,
      }));
      return {
        statusCode: 200,
        bodyType: "json",
        body: {
          success: false,
          error_message: errorMessage,
        },
      };
    }

    const attemptResult = await Result.retry(async () => {
      const attempts = await svix.messageAttempt.listByMsg(
        projectId,
        messageResult.data.id,
        { status: MessageStatus.Success }
      );
      const success = attempts.data.some(a => a.endpointId === body.endpoint_id);
      return success ? Result.ok(undefined) : Result.error("No successful attempt found");
    }, 3);

    if (attemptResult.status === "error") {
      return {
        statusCode: 200,
        bodyType: "json",
        body: {
          success: false,
          error_message: "Webhook not delivered. Make sure the endpoint is configured correctly.",
        },
      };
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
