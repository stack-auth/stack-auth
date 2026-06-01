import { getPrismaClientForTenancy, getPrismaSchemaForTenancy, sqlQuoteIdent } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, adminAuthTypeSchema, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

export const GET = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
    }),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      total_users: yupNumber().integer().defined(),
      anonymous_users: yupNumber().integer().defined(),
    }).defined(),
  }),
  handler: async (req) => {
    const schema = await getPrismaSchemaForTenancy(req.auth.tenancy);
    const prisma = await getPrismaClientForTenancy(req.auth.tenancy);

    const rows = await prisma.$replica().$queryRaw<[{
      total_users: number,
      anonymous_users: number,
    }]>`
      SELECT
        COUNT(*)::int AS total_users,
        COUNT(*) FILTER (WHERE "isAnonymous" = true)::int AS anonymous_users
      FROM ${sqlQuoteIdent(schema)}."ProjectUser"
      WHERE "tenancyId" = ${req.auth.tenancy.id}::UUID
    `;

    const counts = rows[0];
    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        total_users: Number(counts.total_users),
        anonymous_users: Number(counts.anonymous_users),
      },
    };
  },
});
