import { getGcpSecretId, migrateSecretsToGcp } from "@/lib/gcp-secret-migration";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { yupArray, yupBoolean, yupNumber, yupObject, yupString, yupTuple } from "@hexclave/shared/dist/schema-fields";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { StatusError } from "@hexclave/shared/dist/utils/errors";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 300;

const GCP_PROJECT_ID = "hexclave";

const SOURCE_SECRET_IDS = [
  "HEXCLAVE_ASK_HEXCLAVE_DISCORD_WEBHOOK_URL",
  "HEXCLAVE_AWS_KMS_ENDPOINT",
  "HEXCLAVE_AWS_REGION",
  "HEXCLAVE_BULLDOZER_SERVER_SECRET",
  "HEXCLAVE_CLICKHOUSE_ADMIN_PASSWORD",
  "HEXCLAVE_CLICKHOUSE_ADMIN_USER",
  "HEXCLAVE_CLICKHOUSE_EXTERNAL_PASSWORD",
  "HEXCLAVE_CLICKHOUSE_URL",
  "HEXCLAVE_DATABASE_CONNECTION_STRING",
  "HEXCLAVE_DATABASE_REPLICA_CONNECTION_STRING",
  "HEXCLAVE_EMAILABLE_API_KEY",
  "HEXCLAVE_EMAIL_MONITOR_RESEND_EMAIL_API_KEY",
  "HEXCLAVE_EMAIL_PASSWORD",
  "HEXCLAVE_GROWTH_AGENT_API_SECRET",
  "HEXCLAVE_GROWTH_EVE_URL",
  "HEXCLAVE_INTERNAL_PROJECT_PUBLISHABLE_CLIENT_KEY",
  "HEXCLAVE_INTERNAL_PROJECT_SECRET_SERVER_KEY",
  "HEXCLAVE_MARSHAL_API_KEY",
  "HEXCLAVE_MCP_LOG_TOKEN",
  "HEXCLAVE_MICROSOFT_CLIENT_SECRET",
  "HEXCLAVE_RESEND_API_KEY",
  "HEXCLAVE_RESEND_WEBHOOK_SECRET",
  "HEXCLAVE_SVIX_API_KEY",
];

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Migrate Vercel secrets to GCP Secret Manager",
    description: "Temporary internal endpoint for the Vercel-to-GCP migration.",
    tags: ["Internal"],
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({}).nullable().optional(),
    method: yupString().oneOf(["POST"]).defined(),
    headers: yupObject({
      "authorization": yupTuple([yupString()]).defined(),
    }).defined(),
    body: yupObject({
      dry_run: yupBoolean().defined(),
      destination_environment: yupString().oneOf(["dev", "prod"]).defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      created: yupArray(yupString().defined()).defined(),
      skipped_existing: yupArray(yupString().defined()).defined(),
      skipped_unset: yupArray(yupString().defined()).defined(),
      would_create: yupArray(yupString().defined()).defined(),
      source_environment: yupString().defined(),
      destination_environment: yupString().oneOf(["dev", "prod"]).defined(),
    }).defined(),
  }),
  handler: async ({ headers, body }) => {
    const expectedToken = getEnvVariable("HEXCLAVE_GCP_SECRET_MIGRATION_AUTH_TOKEN");
    if (headers.authorization[0] !== `Bearer ${expectedToken}`) {
      throw new StatusError(401, "Unauthorized");
    }

    const sourceEnvironment = getEnvVariable("VERCEL_TARGET_ENV", "");
    if (sourceEnvironment === "") {
      throw new StatusError(400, "VERCEL_TARGET_ENV is not available; invoke this endpoint from a Vercel deployment.");
    }
    if (body.destination_environment === "prod" && sourceEnvironment !== "production") {
      throw new StatusError(400, "The prod destination can only be populated from a production Vercel deployment.");
    }
    if (body.destination_environment === "dev" && sourceEnvironment === "production") {
      throw new StatusError(400, "The dev destination cannot be populated from a production Vercel deployment.");
    }

    const configuredSecrets: { id: string, value: string }[] = [];
    const skippedUnset: string[] = [];
    for (const secretId of SOURCE_SECRET_IDS) {
      const value = getEnvVariable(secretId, "");
      if (value === "") {
        skippedUnset.push(secretId);
      } else {
        configuredSecrets.push({
          id: getGcpSecretId(secretId, body.destination_environment),
          value,
        });
      }
    }

    const result = await migrateSecretsToGcp(
      getEnvVariable("HEXCLAVE_GCP_SECRET_MIGRATION_SERVICE_ACCOUNT_KEY"),
      configuredSecrets,
      body.dry_run,
      GCP_PROJECT_ID,
    );

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        created: result.created,
        skipped_existing: result.skippedExisting,
        skipped_unset: skippedUnset,
        would_create: result.wouldCreate,
        source_environment: sourceEnvironment,
        destination_environment: body.destination_environment,
      },
    };
  },
});
