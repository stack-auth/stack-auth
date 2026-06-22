import { decodeBase64, decodeBase64Url, encodeBase64, encodeBase64Url } from "./bytes";
import { generateRandomValues } from "./crypto";
import { HexclaveAssertionError } from "./errors";

/**
 * App-layer mTLS (client certificate) auth helpers shared between the SDK (browser signing) and the
 * backend (server verification).
 *
 * The flow is a public-key challenge-response, modelled on passkeys but using a user-supplied X.509
 * certificate instead of a WebAuthn credential:
 *   1. The server issues a random `challenge`.
 *   2. The client signs the challenge bytes with the certificate's private key.
 *   3. The server verifies the signature against the certificate's public key.
 *
 * Both signing and verification go through WebCrypto (`globalThis.crypto.subtle`, available in modern
 * Node and browsers). Using the same primitive on both sides avoids the classic ECDSA interop footgun
 * (WebCrypto emits IEEE-P1363 `r||s` signatures, whereas `node:crypto` defaults to DER) — we never have
 * to translate signature encodings. The backend uses `node:crypto.X509Certificate` only to *parse* the
 * certificate (public key, fingerprint, validity, chain), then hands the raw SPKI to the helpers here.
 */

export type MtlsKeyAlgorithm = "RSA" | "EC";

/** A registered client certificate, as surfaced to the SDK (camelCased from the API response). */
export type MtlsCertificateInfo = {
  id: string,
  fingerprint: string,
  subject: string,
  issuer: string,
  displayName: string | null,
  validFrom: string,
  validTo: string,
  createdAt: string,
};

export const MTLS_KEY_ALGORITHMS = ["RSA", "EC"] as const;

// 32 bytes (256 bits) of entropy is plenty for a single-use challenge nonce.
export const MTLS_CHALLENGE_BYTE_LENGTH = 32;

export function isMtlsKeyAlgorithm(value: string): value is MtlsKeyAlgorithm {
  return (MTLS_KEY_ALGORITHMS as readonly string[]).includes(value);
}

/**
 * Maps a `node:crypto` `KeyObject.asymmetricKeyType` (e.g. "rsa", "ec") to our `MtlsKeyAlgorithm`,
 * returning `null` for unsupported key types so callers can reject with a clear error.
 */
export function mtlsKeyAlgorithmFromNodeKeyType(asymmetricKeyType: string | undefined): MtlsKeyAlgorithm | null {
  switch (asymmetricKeyType) {
    case "rsa": return "RSA";
    case "ec": return "EC";
    default: return null;
  }
}

// WebCrypto params for importing the key. We pin RSA to RSASSA-PKCS1-v1_5 + SHA-256 and EC to ECDSA P-256.
function getImportParams(keyAlgorithm: MtlsKeyAlgorithm): RsaHashedImportParams | EcKeyImportParams {
  switch (keyAlgorithm) {
    case "RSA": return { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
    case "EC": return { name: "ECDSA", namedCurve: "P-256" };
  }
}

// WebCrypto params for the actual sign/verify call.
function getSignParams(keyAlgorithm: MtlsKeyAlgorithm): AlgorithmIdentifier | EcdsaParams {
  switch (keyAlgorithm) {
    case "RSA": return { name: "RSASSA-PKCS1-v1_5" };
    case "EC": return { name: "ECDSA", hash: "SHA-256" };
  }
}

function getSubtle(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new HexclaveAssertionError("WebCrypto (globalThis.crypto.subtle) is not available in this environment; mTLS requires it.");
  }
  return subtle;
}

/** Strips the PEM armor and base64-decodes the body into DER bytes. */
export function pemToDer(pem: string): Uint8Array {
  const base64 = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  if (base64.length === 0) {
    throw new HexclaveAssertionError("PEM contained no base64 body");
  }
  return decodeBase64(base64);
}

/** Wraps DER bytes in PEM armor with the given label (e.g. "PRIVATE KEY", "CERTIFICATE"). */
export function derToPem(der: Uint8Array, label: string): string {
  const base64 = encodeBase64(der);
  const lines = base64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;
}

/**
 * Thrown when a private key cannot be normalized to PKCS#8 (e.g. it is encrypted or in an unrecognized
 * format). Carries a user-facing message so the SDK can surface actionable guidance instead of a generic
 * "could not sign" error.
 */
export class MtlsPrivateKeyFormatError extends Error {
  public name = "MtlsPrivateKeyFormatError";
}

// WebCrypto's importKey("pkcs8", ...) ONLY accepts unencrypted PKCS#8 ("-----BEGIN PRIVATE KEY-----").
// Real-world keys are frequently PKCS#1 ("-----BEGIN RSA PRIVATE KEY-----", e.g. `openssl genrsa -traditional`)
// or SEC1 ("-----BEGIN EC PRIVATE KEY-----", e.g. `openssl ecparam -genkey`), which WebCrypto rejects with a
// "DataError: Invalid keyData" even though the key is perfectly valid. We wrap those legacy encodings in a
// PKCS#8 PrivateKeyInfo so they import cleanly: the algorithm identifier is a fixed prefix and the legacy key
// bytes become the PrivateKey OCTET STRING. (The legacy body, including any inner curve params for SEC1, is
// kept verbatim — WebCrypto accepts that.)

// AlgorithmIdentifier DER for rsaEncryption (OID 1.2.840.113549.1.1.1) + NULL parameters.
const RSA_PKCS8_ALGORITHM_ID = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
// AlgorithmIdentifier DER for id-ecPublicKey (OID 1.2.840.10045.2.1) + prime256v1 / P-256 (OID 1.2.840.10045.3.1.7).
const EC_P256_PKCS8_ALGORITHM_ID = [0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07];

/** Encodes a DER definite length (short form < 128, otherwise long form). */
function encodeDerLength(length: number): number[] {
  if (length < 0x80) return [length];
  const bytes: number[] = [];
  let remaining = length;
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff);
    remaining = Math.floor(remaining / 256);
  }
  return [0x80 | bytes.length, ...bytes];
}

/** Builds a DER TLV (tag, definite length, value). */
function encodeDerTlv(tag: number, content: number[]): number[] {
  return [tag, ...encodeDerLength(content.length), ...content];
}

/** Wraps a legacy private-key DER body (PKCS#1 or SEC1) in a PKCS#8 PrivateKeyInfo with the given algId. */
function wrapInPkcs8(algorithmIdentifier: number[], legacyKeyDer: Uint8Array): Uint8Array {
  const version = [0x02, 0x01, 0x00]; // INTEGER 0
  const privateKeyOctetString = encodeDerTlv(0x04, Array.from(legacyKeyDer));
  const body = [...version, ...algorithmIdentifier, ...privateKeyOctetString];
  return Uint8Array.from(encodeDerTlv(0x30, body)); // SEQUENCE { version, algId, privateKey }
}

/** Reads the PEM type label (e.g. "RSA PRIVATE KEY") from the first armor line, if present. */
function getPemLabel(pem: string): string | null {
  return pem.match(/-----BEGIN ([A-Za-z0-9 ]+?)-----/)?.[1]?.trim() ?? null;
}

/**
 * Normalizes a private-key PEM to PKCS#8 DER bytes, converting legacy PKCS#1 (RSA) and SEC1 (EC P-256)
 * encodings so WebCrypto can import them. Throws {@link MtlsPrivateKeyFormatError} (with a user-facing
 * message) for encrypted or unrecognized keys.
 */
export function privateKeyToPkcs8Der(privateKeyPem: string): Uint8Array {
  const label = getPemLabel(privateKeyPem);
  switch (label) {
    case "PRIVATE KEY": {
      return pemToDer(privateKeyPem); // already PKCS#8
    }
    case "RSA PRIVATE KEY": {
      return wrapInPkcs8(RSA_PKCS8_ALGORITHM_ID, pemToDer(privateKeyPem)); // PKCS#1 → PKCS#8
    }
    case "EC PRIVATE KEY": {
      return wrapInPkcs8(EC_P256_PKCS8_ALGORITHM_ID, pemToDer(privateKeyPem)); // SEC1 (P-256) → PKCS#8
    }
    case "ENCRYPTED PRIVATE KEY": {
      throw new MtlsPrivateKeyFormatError("The private key is encrypted. Decrypt it first (e.g. `openssl pkcs8 -topk8 -nocrypt -in key.pem -out key.pkcs8.pem`) before using it.");
    }
    default: {
      throw new MtlsPrivateKeyFormatError("Unrecognized private key format. Provide an unencrypted PEM private key (PKCS#8, PKCS#1, or SEC1).");
    }
  }
}

/** Generates a fresh single-use challenge, returned as base64url. */
export function generateMtlsChallenge(): string {
  return encodeBase64Url(generateRandomValues(new Uint8Array(MTLS_CHALLENGE_BYTE_LENGTH)));
}

/**
 * Imports a private key for signing a challenge. Accepts a PEM string (PKCS#8, PKCS#1, or SEC1 — legacy
 * encodings are normalized to PKCS#8 first) or raw PKCS#8 DER bytes.
 */
export async function importMtlsPrivateKey(privateKey: string | Uint8Array, keyAlgorithm: MtlsKeyAlgorithm): Promise<CryptoKey> {
  const der = typeof privateKey === "string" ? privateKeyToPkcs8Der(privateKey) : privateKey;
  return await getSubtle().importKey("pkcs8", der as BufferSource, getImportParams(keyAlgorithm), false, ["sign"]);
}

/** Imports a SubjectPublicKeyInfo (SPKI) public key (DER bytes or base64url) for verifying a signature. */
export async function importMtlsPublicKey(spki: string | Uint8Array, keyAlgorithm: MtlsKeyAlgorithm): Promise<CryptoKey> {
  const der = typeof spki === "string" ? decodeBase64Url(spki) : spki;
  return await getSubtle().importKey("spki", der as BufferSource, getImportParams(keyAlgorithm), false, ["verify"]);
}

/**
 * Signs a base64url challenge with a PKCS#8 private key, returning the signature as base64url.
 * Used by the SDK in the browser.
 */
export async function signMtlsChallenge(options: {
  privateKey: string | Uint8Array | CryptoKey,
  keyAlgorithm: MtlsKeyAlgorithm,
  challenge: string,
}): Promise<string> {
  const key = options.privateKey instanceof CryptoKey
    ? options.privateKey
    : await importMtlsPrivateKey(options.privateKey, options.keyAlgorithm);
  const signature = await getSubtle().sign(
    getSignParams(options.keyAlgorithm),
    key,
    decodeBase64Url(options.challenge) as BufferSource,
  );
  return encodeBase64Url(new Uint8Array(signature));
}

/**
 * Verifies a base64url signature over a base64url challenge against an SPKI public key.
 * Used by the backend. Returns `false` on any malformed input rather than throwing, so a single
 * boolean drives the auth decision.
 */
export async function verifyMtlsChallenge(options: {
  publicKey: string | Uint8Array | CryptoKey,
  keyAlgorithm: MtlsKeyAlgorithm,
  challenge: string,
  signature: string,
}): Promise<boolean> {
  try {
    const key = options.publicKey instanceof CryptoKey
      ? options.publicKey
      : await importMtlsPublicKey(options.publicKey, options.keyAlgorithm);
    return await getSubtle().verify(
      getSignParams(options.keyAlgorithm),
      key,
      decodeBase64Url(options.signature) as BufferSource,
      decodeBase64Url(options.challenge) as BufferSource,
    );
  } catch {
    // Malformed signature/challenge/key encoding — treat as a failed verification, never an auth bypass.
    return false;
  }
}

import.meta.vitest?.test("signMtlsChallenge round-trips for RSA and EC", async ({ expect }) => {
  const subtle = globalThis.crypto.subtle;
  for (const keyAlgorithm of MTLS_KEY_ALGORITHMS) {
    const params = keyAlgorithm === "RSA"
      ? { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) }
      : { name: "ECDSA", namedCurve: "P-256" };
    const keyPair = await subtle.generateKey(params as any, true, ["sign", "verify"]);
    const privateKeyDer = new Uint8Array(await subtle.exportKey("pkcs8", keyPair.privateKey));
    const publicKeyDer = new Uint8Array(await subtle.exportKey("spki", keyPair.publicKey));

    const challenge = generateMtlsChallenge();
    const signature = await signMtlsChallenge({ privateKey: privateKeyDer, keyAlgorithm, challenge });

    expect(await verifyMtlsChallenge({ publicKey: publicKeyDer, keyAlgorithm, challenge, signature })).toBe(true);
    // A tampered challenge must not verify.
    expect(await verifyMtlsChallenge({ publicKey: publicKeyDer, keyAlgorithm, challenge: generateMtlsChallenge(), signature })).toBe(false);
    // A garbage signature must return false (not throw).
    expect(await verifyMtlsChallenge({ publicKey: publicKeyDer, keyAlgorithm, challenge, signature: "not-base64url!!" })).toBe(false);
  }
});

import.meta.vitest?.test("verifyMtlsChallenge rejects a signature from a different key", async ({ expect }) => {
  const subtle = globalThis.crypto.subtle;
  const mk = async () => {
    const kp = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    return {
      priv: new Uint8Array(await subtle.exportKey("pkcs8", kp.privateKey)),
      pub: new Uint8Array(await subtle.exportKey("spki", kp.publicKey)),
    };
  };
  const a = await mk();
  const b = await mk();
  const challenge = generateMtlsChallenge();
  const signature = await signMtlsChallenge({ privateKey: a.priv, keyAlgorithm: "EC", challenge });
  expect(await verifyMtlsChallenge({ publicKey: b.pub, keyAlgorithm: "EC", challenge, signature })).toBe(false);
});

// Regression test for the production bug where WebCrypto rejected legacy key encodings: a valid PKCS#1
// (RSA) or SEC1 (EC) PEM must sign successfully after normalization to PKCS#8. These are throwaway test
// keys generated with `openssl`, NOT real credentials.
import.meta.vitest?.describe("legacy private-key formats", () => {
  // openssl genrsa -traditional  (PKCS#1, "BEGIN RSA PRIVATE KEY")
  const RSA_PKCS1_PEM = `-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA25PNIfzA5eKO/pJqzlztwpdx/YcAWkn/FcClyXEU+4Eqr6bJ
6lqSDMGJiGzfj5tEAToRlrn18M3mti7gE6KHHquKkSEDSn9o4G9qRNNIHJLbs/rt
sfeuMMoxXqLx0S94/y7lSAeDwIMv7s/YZoefdDTUBHihMPFmv3x2+LLnHyAXmIBZ
94IbnJOzK4baJq2J8cOhqYiNwvAX5DP0xq4/G+X7ljdOw0ire+Wfv/zB+mRF34uK
dGTEPA4O0NwfPjC9BEdwFyWvcLsJscUqXvL33xXH5Nnp4HXNcbc6Qmm57yNQXG32
SAdj/gwHq6BtjL22NquO8uLBxzIwt2QkpYCJsQIDAQABAoIBAAWfnTuhSfWtQesl
R/LbbIus9iJ3h1fYoK2/gIN2Z+KZ1BR5756G1aoZ2A5QVwCqGeGT6ZTIFBNX66Bn
do3MLhyYCTlGrJtXJGIImnKzLEvuiy3Kp7Ukzi9R01Y8kze/uPAkpOK9jgdTeMob
hLvZ/fiDfJlVd0/eA9sUOoYLq2mHrEUgbNEdtNmscTymWbKkxybgVUz6Jq6gKiR3
3HMW9kIF6NJ/22bx5ACkAAfTtrMn4cAm0juQTY+03ZOnO9/U1cyBHT/hDV0ivzaQ
LmXXL9rleOCFJv5re4jpFpllqxr0NYPrnmuEx7XpWMfWyZT0YCGRNcbITQg0F/dR
pzddn8ECgYEA/YcnOBeLM+amGzR4X+LjCiqqVM1UXmD7gDbrJXkfRFlW5Dy4dwa/
gwS5tyX+APA8o2RU7lfza9dBYxgsCfA11ixrvShY28j7HgGf8+bqeSt+OjKKaS6v
kA/8swAGsEtqkV+kBjHxNvJKxn8FlTY4r99OctjnVo87JsUif4ZYz/ECgYEA3bfm
5E57lgY+ccDqrVKeNoFP+MNjW2j07GIPwAx0TT+fBltw/0oF0ywBh2AkZ27w3VwK
QLq3xc7wG7LrvAfat/eHiz1hLOP9JLthpXbKYPdIAmCtgwdJPDTbzjG2JxYdDbUm
PQ0a3BMiS+iFisWU8Ngi4SItjQVTy2WOFQhNFcECgYBzgzTXVcLS7vAXzRxbc+DG
LRJWeQdLyRxOGreg50LbvWjdrNzPPn/bjjefvuuwOcUnHPulbOU36WedYtIN5Shi
YPLlyJBT84qW7V6XnkqO0sY8dfKiYecT2HTmiciCYpo3ikANoouo4VQ4hH9isMW7
PB9eLH2a7r+gtok1WVz1wQKBgQDOtSGCQNlfqTqWezFPnfL7Bdw1JJSBKH0P1Oyy
M+pKCsKL/rx+hdigZCqYt7244OmWtrSoXGvw81lPuaOljf0P/qpT2km6vGPJ1xjW
VsWfWWu9K70Yp7ZTd0RmHFqiXi+AFB8uVAVyoDQdaQ73rfWKBTefhWnKS+kve+LX
IQIdAQKBgQCPx0Xsn6rrzn+NWLHJHeLyrr8btP++aUbhlCT7pGsXbXXG0kdU4iVN
OJt6+28+xXoSSB906fO44XjjFikWM3cIMzguV8ooooOpcuJe8kwuZTfZ6Uo9pwD1
9iW26ygzRK69xxW329ds3iGLACGi8fYdeNYnTF06RwQjayDIWm01bA==
-----END RSA PRIVATE KEY-----`;
  const RSA_SPKI_PEM = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA25PNIfzA5eKO/pJqzlzt
wpdx/YcAWkn/FcClyXEU+4Eqr6bJ6lqSDMGJiGzfj5tEAToRlrn18M3mti7gE6KH
HquKkSEDSn9o4G9qRNNIHJLbs/rtsfeuMMoxXqLx0S94/y7lSAeDwIMv7s/YZoef
dDTUBHihMPFmv3x2+LLnHyAXmIBZ94IbnJOzK4baJq2J8cOhqYiNwvAX5DP0xq4/
G+X7ljdOw0ire+Wfv/zB+mRF34uKdGTEPA4O0NwfPjC9BEdwFyWvcLsJscUqXvL3
3xXH5Nnp4HXNcbc6Qmm57yNQXG32SAdj/gwHq6BtjL22NquO8uLBxzIwt2QkpYCJ
sQIDAQAB
-----END PUBLIC KEY-----`;
  // openssl ecparam -name prime256v1 -genkey  (SEC1, "BEGIN EC PRIVATE KEY")
  const EC_SEC1_PEM = `-----BEGIN EC PRIVATE KEY-----
MHcCAQEEIJ2nsztd8kMNce39m5OEAMPLtyG/WgBCFooXVjcyNa0QoAoGCCqGSM49
AwEHoUQDQgAEDc2scHqjZXx4cEiJvfdnk2LMnBm4mPLx6oRd5+jc+Hv/lwgXIfFa
RlGPqh98XnKIgAsYOTQbxApp2Qzn0GuleQ==
-----END EC PRIVATE KEY-----`;
  const EC_SPKI_PEM = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEDc2scHqjZXx4cEiJvfdnk2LMnBm4
mPLx6oRd5+jc+Hv/lwgXIfFaRlGPqh98XnKIgAsYOTQbxApp2Qzn0GuleQ==
-----END PUBLIC KEY-----`;

  import.meta.vitest!.test("RSA PKCS#1 key signs and verifies (the production bug)", async ({ expect }) => {
    const challenge = generateMtlsChallenge();
    const signature = await signMtlsChallenge({ privateKey: RSA_PKCS1_PEM, keyAlgorithm: "RSA", challenge });
    expect(await verifyMtlsChallenge({ publicKey: pemToDer(RSA_SPKI_PEM), keyAlgorithm: "RSA", challenge, signature })).toBe(true);
  });

  import.meta.vitest!.test("EC SEC1 key signs and verifies", async ({ expect }) => {
    const challenge = generateMtlsChallenge();
    const signature = await signMtlsChallenge({ privateKey: EC_SEC1_PEM, keyAlgorithm: "EC", challenge });
    expect(await verifyMtlsChallenge({ publicKey: pemToDer(EC_SPKI_PEM), keyAlgorithm: "EC", challenge, signature })).toBe(true);
  });

  import.meta.vitest!.test("encrypted private keys throw a clear, actionable error", ({ expect }) => {
    expect(() => privateKeyToPkcs8Der("-----BEGIN ENCRYPTED PRIVATE KEY-----\nAAAA\n-----END ENCRYPTED PRIVATE KEY-----"))
      .toThrow(MtlsPrivateKeyFormatError);
  });
});
