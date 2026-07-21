import { ensureWorkflowsEnabled } from "@/lib/workflows/gate";
import { globalPrismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, yupArray, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";

// Per-environment key/value secrets, injected as env vars into the workflow
// sandbox at invocation. Values are write-only through this API: the list
// endpoint returns keys + timestamps, never values.

export const GET = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: yupString().oneOf(["admin"]).defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      secrets: yupArray(yupMixed().defined()).defined(),
    }).defined(),
  }),
  async handler({ auth: { tenancy } }) {
    ensureWorkflowsEnabled(tenancy.project.id);
    const secrets = await globalPrismaClient.workflowSecret.findMany({
      where: { tenancyId: tenancy.id },
      orderBy: { key: "asc" },
      select: { key: true, createdAt: true, updatedAt: true },
    });
    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        secrets: secrets.map((secret) => ({
          key: secret.key,
          created_at_millis: secret.createdAt.getTime(),
          updated_at_millis: secret.updatedAt.getTime(),
        })),
      },
    };
  },
});

export const POST = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: yupString().oneOf(["admin"]).defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    body: yupObject({
      key: yupString().defined(),
      value: yupString().defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      key: yupString().defined(),
    }).defined(),
  }),
  async handler({ auth: { tenancy }, body }) {
    ensureWorkflowsEnabled(tenancy.project.id);
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(body.key)) {
      throw new StatusError(400, "Secret keys must be valid env var names (letters, digits, underscores; not starting with a digit; max 128 chars)");
    }
    if (Buffer.byteLength(body.value, "utf8") > 32 * 1024) {
      throw new StatusError(400, "Secret values must be at most 32 KiB");
    }
    await globalPrismaClient.workflowSecret.upsert({
      where: { tenancyId_key: { tenancyId: tenancy.id, key: body.key } },
      create: { tenancyId: tenancy.id, key: body.key, value: body.value },
      update: { value: body.value },
    });
    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        key: body.key,
      },
    };
  },
});
