import { createAuthMigrationJob, listAuthMigrationJobs } from "@/lib/auth-migrations/jobs";
import { validateAuthMigrationCredentials } from "@/lib/auth-migrations/providers";
import { authMigrationProviders, type AuthMigrationCredentials } from "@/lib/auth-migrations/types";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, adminAuthTypeSchema, yupArray, yupMixed, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";

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

function assertCredentialsObject(credentials: unknown): AuthMigrationCredentials {
  if (typeof credentials !== "object" || credentials === null || Array.isArray(credentials)) {
    throw new StatusError(400, "credentials must be an object.");
  }
  return credentials as AuthMigrationCredentials;
}

export const GET = createSmartRouteHandler({
  metadata: {
    hidden: true,
    summary: "List auth migration jobs",
    description: "Lists provider migration jobs for the current project branch.",
    tags: ["Migrations"],
  },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      items: yupArray(jobResponseSchema).defined(),
    }).defined(),
  }),
  handler: async ({ auth }) => {
    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        items: await listAuthMigrationJobs(auth.tenancy.id),
      },
    };
  },
});

export const POST = createSmartRouteHandler({
  metadata: {
    hidden: true,
    summary: "Create auth migration job",
    description: "Creates a queued auth provider migration job for the current project branch.",
    tags: ["Migrations"],
  },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
      user: adaptSchema.optional(),
    }).defined(),
    body: yupObject({
      provider: yupString().oneOf(authMigrationProviders).defined(),
      credentials: yupMixed<AuthMigrationCredentials>().defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: jobResponseSchema,
  }),
  handler: async ({ auth, body }) => {
    const credentials = assertCredentialsObject(body.credentials);
    validateAuthMigrationCredentials(body.provider, credentials);
    const job = await createAuthMigrationJob({
      tenancyId: auth.tenancy.id,
      projectId: auth.tenancy.project.id,
      branchId: auth.tenancy.branchId,
      provider: body.provider,
      credentials,
      createdByProjectUserId: auth.user?.id ?? null,
    });
    return {
      statusCode: 200,
      bodyType: "json",
      body: job,
    };
  },
});
