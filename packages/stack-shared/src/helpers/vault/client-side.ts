import { decodeBase64, encodeBase64 } from "../../utils/bytes";
import { decrypt, encrypt, hash, iteratedHash } from "../../utils/crypto";

const hashPurpose = "stack-data-vault-client-side-encryption-key-hash";
const encryptionSecretPurpose = "stack-data-vault-client-side-encryption-value-encryption-key-hash";
const encryptionValuePurpose = "stack-data-vault-client-side-encryption-value-encryption-value-encryption";


async function getDerivedKey(secret: string, key: string) {
  return await iteratedHash({
    purpose: encryptionSecretPurpose,
    extra: secret,
    value: key,
    iterations: 100_000,
  });
}

/**
 * Use to hash the key so the server cannot infer it.
 */
export async function hashKey(secret: string, key: string) {
  return encodeBase64(await hash({
    purpose: hashPurpose,
    extra: secret,
    value: await getDerivedKey(secret, key),
  }));
}

/**
 * Use to encrypt the value so that the server cannot read the value without knowing the key.
 */
export async function encryptValue(secret: string, key: string, value: string) {
  const valueEncryptionDerivedKey = await getDerivedKey(secret, key);

  const bytes = await encrypt({
    purpose: encryptionValuePurpose,
    secret: valueEncryptionDerivedKey,
    value: new TextEncoder().encode(value)
  });
  return encodeBase64(bytes);
}

/**
 * Use to decrypt the value. See encryptValue.
 */
export async function decryptValue(secret: string, key: string, encryptedValue: string) {
  const valueEncryptionDerivedKey = await getDerivedKey(secret, key);

  const bytesResult = await decrypt({
    purpose: encryptionValuePurpose,
    secret: valueEncryptionDerivedKey,
    cipher: decodeBase64(encryptedValue),
  });
  if (bytesResult.status === "error") throw new Error("Data vault client-side decryption failed. Are you sure you're using the correct secret?", { cause: bytesResult.error });
  return new TextDecoder().decode(bytesResult.data);
}


import.meta.vitest?.describe("encryptValue & decryptValue", () => {
  import.meta.vitest?.it("should encrypt and decrypt a value", async ({ expect }) => {
    const secret = "test-secret";
    const value = "test-value";
    const encrypted = await encryptValue(secret, "key", value);
    const decrypted = await decryptValue(secret, "key", encrypted);
    expect(decrypted).toEqual(value);
  });

  import.meta.vitest?.it("should not decrypt a value with a different secret", async ({ expect }) => {
    const secret = "test-secret";
    const value = "test-value";
    const encrypted = await encryptValue(secret, "key", value);
    await expect(decryptValue("different-secret", "key", encrypted)).rejects.toThrow();
  });

  import.meta.vitest?.it("should not decrypt a value with a different key", async ({ expect }) => {
    const secret = "test-secret";
    const value = "test-value";
    const encrypted = await encryptValue(secret, "key", value);
    await expect(decryptValue(secret, "different-key", encrypted)).rejects.toThrow();
  });

  import.meta.vitest?.it("should not decrypt a value if the cipher was tampered with", async ({ expect }) => {
    const secret = "test-secret";
    const value = "test-value";
    const encrypted = await encryptValue(secret, "key", value);
    const tampered = encrypted + "7";
    await expect(decryptValue(secret, "key", tampered)).rejects.toThrow();
  });
});
