import { KnownErrors } from "@hexclave/shared";
import { MtlsKeyAlgorithm, mtlsKeyAlgorithmFromNodeKeyType } from "@hexclave/shared/dist/utils/mtls";
import crypto, { X509Certificate } from "node:crypto";

/**
 * Server-side X.509 parsing/validation for the app-layer mTLS auth method.
 *
 * Parsing, fingerprinting and CA-chain validation use Node's built-in `node:crypto.X509Certificate`
 * (no third-party dependency). The challenge SIGNATURE itself is verified with the shared WebCrypto
 * helper (`verifyMtlsChallenge` in `@hexclave/shared/dist/utils/mtls`), so the client (which signs with
 * WebCrypto) and the server (which verifies with WebCrypto) always agree on the signature encoding.
 */

export type ParsedClientCertificate = {
  fingerprint: string,          // SHA-256 of the DER certificate, lowercase hex without separators
  spkiBase64Url: string,        // SubjectPublicKeyInfo (SPKI), DER, base64url
  subject: string,
  issuer: string,
  serialNumber: string,
  keyAlgorithm: MtlsKeyAlgorithm,
  signatureAlgorithm: string,
  validFrom: Date,
  validTo: Date,
};

// Small leeway for clock skew so freshly-generated or about-to-expire certificates aren't rejected
// over a few seconds of difference between the signer's and the server's clocks.
const CLOCK_SKEW_LEEWAY_MS = 60_000;

/** Splits a PEM bundle (possibly containing multiple concatenated certificates) into individual PEMs. */
function splitPemCertificates(pemBundle: string): string[] {
  const matches = pemBundle.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
  return matches ?? [];
}

/**
 * Parses and validates the structure of a client certificate, throwing `MtlsCertificateInvalid` with a
 * user-facing message on any problem. Does NOT check the validity window or CA chain — see the dedicated
 * helpers below.
 */
export function parseClientCertificate(pem: string): ParsedClientCertificate {
  let x509: X509Certificate;
  try {
    x509 = new X509Certificate(pem);
  } catch {
    throw new KnownErrors.MtlsCertificateInvalid("The certificate could not be parsed. Provide a PEM-encoded X.509 certificate.");
  }

  const publicKey = x509.publicKey;
  const keyAlgorithm = mtlsKeyAlgorithmFromNodeKeyType(publicKey.asymmetricKeyType);
  if (!keyAlgorithm) {
    throw new KnownErrors.MtlsCertificateInvalid(`Unsupported certificate key type "${publicKey.asymmetricKeyType ?? "unknown"}". Only RSA and EC (P-256) keys are supported.`);
  }

  // Pin to the same parameters the WebCrypto verifier uses (RSA ≥ 2048 + SHA-256, EC = P-256). Rejecting
  // here gives a clear error instead of a confusing signature-verification failure later.
  const details = publicKey.asymmetricKeyDetails ?? {};
  if (keyAlgorithm === "RSA" && (details.modulusLength ?? 0) < 2048) {
    throw new KnownErrors.MtlsCertificateInvalid("RSA certificates must use a key of at least 2048 bits.");
  }
  if (keyAlgorithm === "EC" && details.namedCurve !== "prime256v1") {
    throw new KnownErrors.MtlsCertificateInvalid("EC certificates must use the P-256 (prime256v1) curve.");
  }

  const spkiDer = publicKey.export({ type: "spki", format: "der" });
  const fingerprint = crypto.createHash("sha256").update(x509.raw).digest("hex");

  // Node's X509Certificate exposes `signatureAlgorithm` at runtime, but the installed @types/node
  // version doesn't declare it yet. Read it through a narrow structural type (not `any`) and fall back
  // to "unknown" if absent. This value is informational only — it is never used to verify a signature.
  const signatureAlgorithm = (x509 as unknown as { signatureAlgorithm?: string }).signatureAlgorithm ?? "unknown";

  return {
    fingerprint,
    spkiBase64Url: spkiDer.toString("base64url"),
    subject: x509.subject,
    issuer: x509.issuer,
    serialNumber: x509.serialNumber,
    keyAlgorithm,
    signatureAlgorithm,
    validFrom: new Date(x509.validFrom),
    validTo: new Date(x509.validTo),
  };
}

/** Returns true if `now` is within the certificate's validity window (with clock-skew leeway). */
export function isCertificateTemporallyValid(cert: Pick<ParsedClientCertificate, "validFrom" | "validTo">, now: Date = new Date()): boolean {
  const nowMs = now.getTime();
  return nowMs >= cert.validFrom.getTime() - CLOCK_SKEW_LEEWAY_MS
    && nowMs <= cert.validTo.getTime() + CLOCK_SKEW_LEEWAY_MS;
}

/**
 * Returns true if `certPem` was directly issued by (and signed by) at least one of the CA certificates in
 * `trustedCaPem`. Covers the common "pin the issuing CA" case; certificates issued by an intermediate that
 * is not included in the bundle are rejected (admins should include the issuing CA in the bundle).
 */
export function certificateChainsToTrustedCa(certPem: string, trustedCaPem: string): boolean {
  let cert: X509Certificate;
  try {
    cert = new X509Certificate(certPem);
  } catch {
    return false;
  }
  const caCerts = splitPemCertificates(trustedCaPem);
  if (caCerts.length === 0) return false;

  return caCerts.some((caPem) => {
    try {
      const ca = new X509Certificate(caPem);
      // checkIssued() confirms the issuer/subject + key-identifier relationship; verify() confirms the CA
      // actually signed this certificate. Require both.
      return cert.checkIssued(ca) && cert.verify(ca.publicKey);
    } catch {
      return false;
    }
  });
}
