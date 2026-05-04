import { decodeBase64, encodeBase64 } from "@stackframe/stack-shared/dist/utils/bytes";
import { encrypt, decrypt } from "@stackframe/stack-shared/dist/utils/crypto";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import type { AuthMigrationCredentials, EncryptedMigrationCredentials } from "./types";

const encryptionPurpose = "stack-auth-provider-migration-credentials";

export async function encryptMigrationCredentials(credentials: AuthMigrationCredentials): Promise<EncryptedMigrationCredentials> {
  const ciphertext = await encrypt({
    purpose: encryptionPurpose,
    secret: getEnvVariable("STACK_SERVER_SECRET"),
    value: new TextEncoder().encode(JSON.stringify(credentials)),
  });
  return {
    ciphertext_base64: encodeBase64(ciphertext),
  };
}

export async function decryptMigrationCredentials(encrypted: EncryptedMigrationCredentials): Promise<AuthMigrationCredentials> {
  const plaintext = Result.orThrow(await decrypt({
    purpose: encryptionPurpose,
    secret: getEnvVariable("STACK_SERVER_SECRET"),
    cipher: decodeBase64(encrypted.ciphertext_base64),
  }));
  return JSON.parse(new TextDecoder().decode(plaintext)) as AuthMigrationCredentials;
}
