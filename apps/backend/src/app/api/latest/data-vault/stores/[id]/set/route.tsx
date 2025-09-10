import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { encryptWithKms } from "@stackframe/stack-shared/dist/helpers/vault/server-side";
import { adaptSchema, serverOrHigherAuthTypeSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Store encrypted value in data vault",
    description: "Stores a hashed key and encrypted value in the data vault for a specific store",
    tags: ["DataVault"],
  },
  request: yupObject({
    auth: yupObject({
      type: serverOrHigherAuthTypeSchema,
      tenancy: adaptSchema,
    }).defined(),
    params: yupObject({
      id: yupString().defined(),
    }).defined(),
    body: yupObject({
      hashed_key: yupString().defined().nonEmpty(),
      encrypted_value: yupString().defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["success"]).defined(),
  }),
  async handler({ auth: { tenancy }, params: { id: storeId }, body: { hashed_key: hashedKey, encrypted_value: encryptedValue } }) {
    // Check if data vault is configured for this store
    if (!(storeId in tenancy.config.dataVault.stores)) {
      throw new KnownErrors.DataVaultStoreDoesNotExist(storeId);
    }

    const prisma = await getPrismaClientForTenancy(tenancy);

    // Encrypt the value with KMS
    // note that encryptedValue is encrypted by client-side encryption, while encrypted is encrypted by both client-side
    // and server-side encryption.
    const encrypted = await encryptWithKms(encryptedValue);
    // Store or update the entry
    await prisma.dataVaultEntry.upsert({
      where: {
        tenancyId_storeId_hashedKey: {
          tenancyId: tenancy.id,
          storeId,
          hashedKey,
        },
      },
      update: {
        encrypted,
      },
      create: {
        tenancyId: tenancy.id,
        storeId,
        hashedKey,
        encrypted,
      },
    });
    return {
      statusCode: 200,
      bodyType: "success",
    };
  },
});
