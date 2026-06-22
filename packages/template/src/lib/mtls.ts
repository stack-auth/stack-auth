import { MtlsKeyAlgorithm, derToPem, signMtlsChallenge } from "@hexclave/shared/dist/utils/mtls";
import * as x509 from "@peculiar/x509";

/**
 * Browser-side mTLS (client certificate) helpers for the SDK.
 *
 * X.509 parsing and self-signed certificate generation use `@peculiar/x509` (isomorphic, backed by the
 * browser's WebCrypto). Challenge signing reuses the shared `signMtlsChallenge` helper so the client and
 * the backend agree on the signature encoding.
 */

// @peculiar/x509 defaults to the global WebCrypto provider, which is what we want in the browser.
function ensureCryptoProvider() {
  if (typeof globalThis.crypto !== "undefined") {
    x509.cryptoProvider.set(globalThis.crypto);
  }
}

/** Determines whether a certificate uses an RSA or EC key (needed to import the private key for signing). */
export function getCertificateKeyAlgorithm(certificatePem: string): MtlsKeyAlgorithm {
  const cert = new x509.X509Certificate(certificatePem);
  const name = cert.publicKey.algorithm.name;
  if (name === "ECDSA" || name === "ECDH") return "EC";
  if (name.startsWith("RSA")) return "RSA";
  throw new Error(`Unsupported certificate key algorithm "${name}". Only RSA and EC (P-256) certificates are supported.`);
}

/**
 * Signs a challenge with the certificate's private key (PKCS#8 PEM). The key algorithm is derived from the
 * accompanying certificate. Returns the base64url signature.
 */
export async function signMtlsChallengeWithCertificate(options: {
  certificatePem: string,
  privateKeyPem: string,
  challenge: string,
}): Promise<string> {
  const keyAlgorithm = getCertificateKeyAlgorithm(options.certificatePem);
  return await signMtlsChallenge({
    privateKey: options.privateKeyPem,
    keyAlgorithm,
    challenge: options.challenge,
  });
}

/**
 * Generates a fresh keypair and a self-signed certificate the user can download and then register. The
 * private key never leaves the browser except as part of the returned PEM (which the user downloads).
 */
export async function generateSelfSignedCertificate(options: {
  keyAlgorithm: MtlsKeyAlgorithm,
  commonName: string,
  validityDays?: number,
}): Promise<{ certificatePem: string, privateKeyPem: string }> {
  ensureCryptoProvider();

  const keyGenParams = options.keyAlgorithm === "RSA"
    ? { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256", publicExponent: new Uint8Array([1, 0, 1]), modulusLength: 2048 }
    : { name: "ECDSA", namedCurve: "P-256" };
  const signingAlgorithm = options.keyAlgorithm === "RSA"
    ? { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }
    : { name: "ECDSA", hash: "SHA-256" };

  const keys = await globalThis.crypto.subtle.generateKey(keyGenParams as EcKeyGenParams | RsaHashedKeyGenParams, true, ["sign", "verify"]);

  const serialBytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const serialNumber = Array.from(serialBytes).map((b) => b.toString(16).padStart(2, "0")).join("");

  const notBefore = new Date();
  const notAfter = new Date(notBefore.getTime() + (options.validityDays ?? 365) * 24 * 60 * 60 * 1000);

  const cert = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber,
    name: `CN=${options.commonName}`,
    notBefore,
    notAfter,
    keys,
    signingAlgorithm,
  });

  const pkcs8 = await globalThis.crypto.subtle.exportKey("pkcs8", keys.privateKey);
  return {
    certificatePem: cert.toString("pem"),
    privateKeyPem: derToPem(new Uint8Array(pkcs8), "PRIVATE KEY"),
  };
}
