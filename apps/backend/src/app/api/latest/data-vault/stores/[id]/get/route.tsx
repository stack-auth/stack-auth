import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { decryptWithKms } from "@stackframe/stack-shared/dist/helpers/vault/server-side";
import { adaptSchema, serverOrHigherAuthTypeSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Retrieve encrypted value from data vault",
    description: "Retrieves and decrypts a value from the data vault using a hashed key",
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
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      encrypted_value: yupString().defined(),
    }).defined(),
  }),
  async handler({ auth: { tenancy }, params: { id: storeId }, body: { hashed_key: hashedKey } }) {
    // Check if data vault is configured for this store
    if (!(storeId in tenancy.config.dataVault.stores)) {
      throw new KnownErrors.DataVaultStoreDoesNotExist(storeId);
    }

    const prisma = await getPrismaClientForTenancy(tenancy);

    // Retrieve the entry
    const entry = await prisma.dataVaultEntry.findUnique({
      where: {
        tenancyId_storeId_hashedKey: {
          tenancyId: tenancy.id,
          storeId,
          hashedKey,
        },
      },
    });

    if (!entry) {
      throw new KnownErrors.DataVaultStoreHashedKeyDoesNotExist(storeId, hashedKey);
    }

    const encryptedData = entry.encrypted as { edkBase64?: string, ciphertextBase64?: string };
    if (!encryptedData.edkBase64 || !encryptedData.ciphertextBase64) {
      throw new StackAssertionError("Corrupted encrypted data", encryptedData);
    }

    const decryptedValue = await decryptWithKms({
      edkBase64: encryptedData.edkBase64,
      ciphertextBase64: encryptedData.ciphertextBase64,
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        // This looks confusing, but it's actually correct. `encrypted_value` refers to the fact that it is encrypted
        // with client-side encryption, while `decryptedValue` refers to the fact that it has been decrypted with
        // server-side encryption.
        encrypted_value: decryptedValue,
      },
    };
  },
});
