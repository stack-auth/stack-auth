import { createDataSource, listDataSources } from "@/lib/data-sources";
import { DATA_SOURCE_SSL_MODES } from "@/lib/data-sources/postgres/client";
import { serializeCatalog, serializeDataSource } from "@/lib/data-sources/serialize";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, adminAuthTypeSchema, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";

// Connects out to the customer's system under a 120s timeout per stream, so it
// needs more than the platform default.
export const maxDuration = 300;

export const GET = createSmartRouteHandler({
  metadata: {
    summary: "List data sources",
    description: "Returns every source configured for this project, with the streams each one syncs.",
    tags: ["Data Warehouse"],
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema,
      tenancy: adaptSchema.defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({ data_sources: yupMixed().defined() }).defined(),
  }),
  handler: async ({ auth }) => ({
    statusCode: 200,
    bodyType: "json",
    body: { data_sources: (await listDataSources(auth.tenancy)).map(serializeDataSource) },
  }),
});

/**
 * Fields that only some source types use are accepted as optional and required
 * per type below, because yup cannot describe a discriminated union of object
 * shapes well enough to do it declaratively. The switch is exhaustive over
 * `type`, so a new source type cannot be added without landing here.
 */
function required<T>(value: T | undefined | null, field: string): T {
  if (value === undefined || value === null || value === "") {
    throw new StatusError(StatusError.BadRequest, `${field} is required for this source type.`);
  }
  return value;
}

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Connect a data source",
    description: "Verifies the credentials, reads the source's catalog, and stores the connection. The secret is encrypted before it is written and is never returned.",
    tags: ["Data Warehouse"],
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema,
      tenancy: adaptSchema.defined(),
    }).defined(),
    method: yupString().oneOf(["POST"]).defined(),
    body: yupObject({
      type: yupString().oneOf(["postgres", "convex"] as const).defined(),
      // PostgreSQL
      host: yupString().optional(),
      port: yupNumber().min(1).max(65535).optional(),
      database: yupString().optional(),
      username: yupString().optional(),
      ssl_mode: yupString().oneOf([...DATA_SOURCE_SSL_MODES]).optional(),
      // Convex
      deployment_url: yupString().optional(),
      // Both: the single secret this source authenticates with — a Postgres
      // password, or a Convex deploy key with `deployment:data:view`.
      secret: yupString().defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      data_source: yupMixed().defined(),
      catalog: yupMixed().defined(),
    }).defined(),
  }),
  handler: async ({ auth, body }) => {
    const input = body.type === "postgres"
      ? {
        type: "postgres" as const,
        config: {
          host: required(body.host, "host"),
          port: required(body.port, "port"),
          database: required(body.database, "database"),
          username: required(body.username, "username"),
          sslMode: body.ssl_mode ?? "require",
        },
        secret: body.secret,
      }
      : {
        type: "convex" as const,
        config: { deploymentUrl: required(body.deployment_url, "deployment_url") },
        secret: body.secret,
      };
    const { source, probe } = await createDataSource(auth.tenancy, input);
    return {
      statusCode: 200,
      bodyType: "json",
      body: { data_source: serializeDataSource(source), catalog: serializeCatalog(probe) },
    };
  },
});
