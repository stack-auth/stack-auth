import { retryAuthMigrationJob } from "@/lib/auth-migrations/jobs";
import { authMigrationProviders } from "@/lib/auth-migrations/types";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, adminAuthTypeSchema, yupMixed, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";

const jobResponseSchema = yupObject({
  id: yupString().uuid().defined(),
  provider: yupString().oneOf(authMigrationProviders).defined(),
  status: yupString().oneOf(["PENDING", "RUNNING", "WAITING_RETRY", "SUCCEEDED", "FAILED"]).defined(),
  attempt_count: yupNumber().integer().defined(),
  max_attempts: yupNumber().integer().defined(),
  next_attempt_at_millis: yupNumber().nullable().defined(),
  started_at_millis: yupNumber().nullable().defined(),
  finished_at_millis: yupNumber().nullable().defined(),
  last_error_external_message: yupString().nullable().defined(),
  result: yupMixed().nullable(),
  created_at_millis: yupNumber().defined(),
  updated_at_millis: yupNumber().defined(),
}).defined();

export const POST = createSmartRouteHandler({
  metadata: {
    hidden: true,
    summary: "Retry auth migration job",
    description: "Moves a failed or waiting provider migration job back to the pending queue.",
    tags: ["Migrations"],
  },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    params: yupObject({
      id: yupString().uuid().defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: jobResponseSchema,
  }),
  handler: async ({ auth, params }) => {
    return {
      statusCode: 200,
      bodyType: "json",
      body: await retryAuthMigrationJob(auth.tenancy.id, params.id),
    };
  },
});
