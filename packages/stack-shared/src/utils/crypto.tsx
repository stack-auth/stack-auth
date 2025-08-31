import { encodeBase32, encodeBase64 } from "./bytes";
import { StackAssertionError } from "./errors";
import { globalVar } from "./globals";
import { Result } from "./results";

export function generateRandomValues(array: Uint8Array): typeof array {
  if (!globalVar.crypto) {
    throw new StackAssertionError("Crypto API is not available in this environment. Are you using an old browser?");
  }
  if (!globalVar.crypto.getRandomValues) {
    throw new StackAssertionError("crypto.getRandomValues is not available in this environment. Are you using an old browser?");
  }
  return globalVar.crypto.getRandomValues(array);
}

/**
 * Generates a secure alphanumeric string using the system's cryptographically secure
 * random number generator.
 */
export function generateSecureRandomString(minBitsOfEntropy: number = 224) {
  const base32CharactersCount = Math.ceil(minBitsOfEntropy / 5);
  const bytesCount = Math.ceil(base32CharactersCount * 5 / 8);
  const randomBytes = generateRandomValues(new Uint8Array(bytesCount));
  const str = encodeBase32(randomBytes);
  return str.slice(str.length - base32CharactersCount).toLowerCase();
}

async function getDerivedSymmetricKey(purpose: string, secret: string | Uint8Array, salt: Uint8Array) {
  const originalSecretKey = await crypto.subtle.importKey("raw", typeof secret === "string" ? new TextEncoder().encode(secret) : secret, "HKDF", false, ["deriveKey"]);
  return await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      salt,
      hash: "SHA-256",
      info: new TextEncoder().encode(JSON.stringify([
        "stack-crypto-helper-derived-symmetric-key",
        purpose,
        typeof secret === "string" ? "string-key" : "binary-key",
        encodeBase64(salt),
      ])),
    },
    originalSecretKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encrypt({ purpose, secret, value }: { purpose: string, secret: string | Uint8Array, value: Uint8Array }) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const derivedSecretKey = await getDerivedSymmetricKey(purpose, secret, salt);

  const cipher = await crypto.subtle.encrypt({
    name: "AES-GCM",
    iv,
  }, derivedSecretKey, value);

  const version = [0x01, 0x00];
  return new Uint8Array([...version, ...salt, ...iv, ...new Uint8Array(cipher)]);
}

export async function decrypt({ purpose, secret, cipher }: { purpose: string, secret: string | Uint8Array, cipher: Uint8Array }) {
  const version = cipher.slice(0, 2);
  if (version[0] !== 0x01 || version[1] !== 0x00) throw new StackAssertionError("Invalid ciphertext version in decrypt(...); expected 0x0100", { purpose });
  const salt = cipher.slice(2, 18);
  const iv = cipher.slice(18, 30);
  const cipherBytes = cipher.slice(30);
  const derivedSecretKey = await getDerivedSymmetricKey(purpose, secret, salt);

  try {
    const plaintext = await crypto.subtle.decrypt({
      name: "AES-GCM",
      iv,
    }, derivedSecretKey, cipherBytes);
    return Result.ok(new Uint8Array(plaintext));
  } catch (e) {
    if (e instanceof DOMException && e.name === "OperationError") {
      return Result.error(new Error("Invalid ciphertext or secret when decrypting encrypted value", { cause: e }));
    }
    throw e;
  }
}

import.meta.vitest?.test("encrypt & decrypt", async ({ expect }) => {
  const encryptAndDecrypt = async (encryptPurpose: string, decryptPurpose: string, encryptSecret: string | Uint8Array, decryptSecret: string | Uint8Array, value: Uint8Array) => {
    const encrypted = await encrypt({ purpose: encryptPurpose, secret: encryptSecret, value });
    const decrypted = await decrypt({ purpose: decryptPurpose, secret: decryptSecret, cipher: encrypted });
    return decrypted;
  };

  const exampleBytes = new TextEncoder().encode("hello");

  const exampleKey1 = crypto.getRandomValues(new Uint8Array(32));
  const exampleKey2 = crypto.getRandomValues(new Uint8Array(32));

  expect(await encryptAndDecrypt("p", "p", "secret", "secret", exampleBytes)).toEqual(Result.ok(exampleBytes));
  expect(await encryptAndDecrypt("p", "p", exampleKey1, exampleKey1, exampleBytes)).toEqual(Result.ok(exampleBytes));
  expect(await encryptAndDecrypt("p", "p", exampleKey1, "secret", exampleBytes)).toEqual(Result.error(expect.objectContaining({ message: "Invalid ciphertext or secret when decrypting encrypted value" })));
  expect(await encryptAndDecrypt("p", "p", exampleKey1, exampleKey2, exampleBytes)).toEqual(Result.error(expect.objectContaining({ message: "Invalid ciphertext or secret when decrypting encrypted value" })));
  expect(await encryptAndDecrypt("p", "not-p", exampleKey1, exampleKey1, exampleBytes)).toEqual(Result.error(expect.objectContaining({ message: "Invalid ciphertext or secret when decrypting encrypted value" })));
});

export type HashOptions = {
  purpose: string,
  salt?: string | Uint8Array,
  extra?: string | Uint8Array,
  value: string | Uint8Array,
};

export async function hash(options: HashOptions) {
  return await iteratedHash({ ...options, iterations: 1 });
}

export async function iteratedHash(options: HashOptions & { iterations: number }) {
  const stringOrUint8ArrayToUint8Array = (value: string | Uint8Array) => typeof value === "string" ? new TextEncoder().encode(value) : value;
  const stringOrUint8ArrayToBase64 = (value: string | Uint8Array) => encodeBase64(stringOrUint8ArrayToUint8Array(value));
  const input = await crypto.subtle.importKey(
    "raw",
    stringOrUint8ArrayToUint8Array(options.value),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  return new Uint8Array(await crypto.subtle.deriveBits({
    name: "PBKDF2",
    salt: new TextEncoder().encode(JSON.stringify([
      "stack-crypto-helper-iterated-hash",
      options.purpose,
      stringOrUint8ArrayToBase64(options.salt ?? ""),
      stringOrUint8ArrayToBase64(options.extra ?? ""),
    ])),
    iterations: options.iterations,
    hash: "SHA-256",
  }, input, 256));
}

import.meta.vitest?.test("iteratedHash", async ({ expect }) => {
  const valueBytes = new TextEncoder().encode("hello");
  const incrementBytes = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x0E, 0x0F, 0x10]);

  const hash = await iteratedHash({ purpose: "purpose", value: valueBytes, iterations: 100_000 });
  const hash2 = await iteratedHash({ purpose: "purpose", value: valueBytes, iterations: 100_000 });
  const hashWithDifferentPurpose = await iteratedHash({ purpose: "different-purpose", value: valueBytes, iterations: 100_000 });
  const hashWithEmptySalt = await iteratedHash({ purpose: "purpose", value: valueBytes, salt: new Uint8Array(0), iterations: 100_000 });
  const hashWithDifferentSalt = await iteratedHash({ purpose: "purpose", value: valueBytes, salt: incrementBytes, iterations: 100_000 });
  const hashWithEmptyExtra = await iteratedHash({ purpose: "purpose", value: valueBytes, extra: new Uint8Array(0), iterations: 100_000 });
  const hashWithDifferentExtra = await iteratedHash({ purpose: "purpose", value: valueBytes, extra: incrementBytes, iterations: 100_000 });
  const hashWithDifferentValue = await iteratedHash({ purpose: "purpose", value: new TextEncoder().encode("hello2"), iterations: 100_000 });
  const hashWithDifferentSaltAndExtra = await iteratedHash({ purpose: "purpose", value: valueBytes, salt: incrementBytes, extra: incrementBytes, iterations: 100_000 });
  const hashWithDifferentIterations = await iteratedHash({ purpose: "purpose", value: valueBytes, iterations: 100_001 });


  expect(hash).toEqual(hash2);
  expect(hash).not.toEqual(hashWithDifferentPurpose);
  expect(hash).toEqual(hashWithEmptySalt);
  expect(hash).not.toEqual(hashWithDifferentSalt);
  expect(hash).toEqual(hashWithEmptyExtra);
  expect(hash).not.toEqual(hashWithDifferentExtra);
  expect(hash).not.toEqual(hashWithDifferentValue);
  expect(hash).not.toEqual(hashWithDifferentIterations);

  expect(hashWithDifferentSalt).not.toEqual(hashWithDifferentExtra);
  expect(hashWithDifferentSalt).not.toEqual(hashWithDifferentSaltAndExtra);
  expect(hashWithDifferentExtra).not.toEqual(hashWithDifferentSaltAndExtra);
});
