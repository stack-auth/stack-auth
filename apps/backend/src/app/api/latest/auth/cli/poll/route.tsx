import { Prisma } from "@/generated/prisma/client";
import { getPrismaClientForTenancy, getPrismaSchemaForTenancy, sqlQuoteIdent } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";

type CliAuthAttemptRow = {
  id: string,
  refreshToken: string | null,
  expiresAt: Date,
  usedAt: Date | null,
};

// Helper function to create response
const createResponse = (status: 'waiting' | 'success' | 'expired' | 'used', refreshToken?: string) => ({
  statusCode: status === 'success' ? 201 : 200,
  bodyType: "json" as const,
  body: {
    status,
    ...(refreshToken && { refresh_token: refreshToken }),
  },
});

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Poll CLI authentication status",
    description: "Check the status of a CLI authentication session using the polling code",
    tags: ["CLI Authentication"],
  },
  request: yupObject({
    auth: yupObject({
      type: clientOrHigherAuthTypeSchema,
      tenancy: adaptSchema.defined(),
    }).defined(),
    body: yupObject({
      polling_code: yupString().defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200, 201]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      status: yupString().oneOf(["waiting", "success", "expired", "used"]).defined(),
      refresh_token: yupString().optional(),
    }).defined(),
  }),
  async handler({ auth: { tenancy }, body: { polling_code } }) {
    const prisma = await getPrismaClientForTenancy(tenancy);
    const schema = await getPrismaSchemaForTenancy(tenancy);

    const cliAuthRows = await prisma.$queryRaw<CliAuthAttemptRow[]>(Prisma.sql`
      SELECT
        "id",
        "refreshToken",
        "expiresAt",
        "usedAt"
      FROM ${sqlQuoteIdent(schema)}."CliAuthAttempt"
      WHERE "tenancyId" = ${tenancy.id}::UUID
        AND "pollingCode" = ${polling_code}
      LIMIT 1
    `);

    if (cliAuthRows.length === 0) {
      throw new KnownErrors.InvalidPollingCodeError();
    }
    const cliAuth = cliAuthRows[0];

    if (cliAuth.expiresAt < new Date()) {
      return createResponse('expired');
    }

    if (cliAuth.usedAt !== null) {
      return createResponse('used');
    }

    if (cliAuth.refreshToken === null) {
      return createResponse('waiting');
    }

    // Atomically mark as used, claiming the row only if no one else has.
    // This prevents a TOCTOU race where two concurrent polls could both
    // read usedAt = null and both receive the same refresh token.
    const claimed = await prisma.$queryRaw<{ refreshToken: string }[]>(Prisma.sql`
      UPDATE ${sqlQuoteIdent(schema)}."CliAuthAttempt"
      SET
        "usedAt" = NOW(),
        "updatedAt" = NOW()
      WHERE "tenancyId" = ${tenancy.id}::UUID
        AND "id" = ${cliAuth.id}::UUID
        AND "usedAt" IS NULL
      RETURNING "refreshToken"
    `);

    if (claimed.length === 0) {
      return createResponse('used');
    }

    return createResponse('success', claimed[0].refreshToken);
  },
});
