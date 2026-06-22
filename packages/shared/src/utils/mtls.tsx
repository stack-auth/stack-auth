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

/** Generates a fresh single-use challenge, returned as base64url. */
export function generateMtlsChallenge(): string {
  return encodeBase64Url(generateRandomValues(new Uint8Array(MTLS_CHALLENGE_BYTE_LENGTH)));
}

/** Imports a PKCS#8 private-key PEM (or DER) for signing a challenge. */
export async function importMtlsPrivateKey(privateKey: string | Uint8Array, keyAlgorithm: MtlsKeyAlgorithm): Promise<CryptoKey> {
  const der = typeof privateKey === "string" ? pemToDer(privateKey) : privateKey;
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
