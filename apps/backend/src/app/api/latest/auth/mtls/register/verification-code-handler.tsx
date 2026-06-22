import { certificateChainsToTrustedCa, isCertificateTemporallyValid, parseClientCertificate } from "@/lib/mtls";
import { getPrismaClientForTenancy, isPrismaUniqueConstraintViolation, retryTransaction } from "@/prisma-client";
import { createVerificationCodeHandler } from "@/route-handlers/verification-code-handler";
import { VerificationCodeType } from "@/generated/prisma/client";
import { KnownErrors } from "@hexclave/shared";
import { yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";
import { verifyMtlsChallenge } from "@hexclave/shared/dist/utils/mtls";

/** Extracts a friendly default display name (the subject CN) from an X.509 subject DN string. */
function defaultDisplayName(subject: string, fingerprint: string): string {
  const commonName = subject.match(/CN=([^\n,]+)/)?.[1]?.trim();
  return commonName || `Certificate ${fingerprint.slice(0, 12)}`;
}

export const mtlsRegisterVerificationCodeHandler = createVerificationCodeHandler({
  metadata: {
    post: {
      summary: "Register a client certificate",
      description: "Register an X.509 client certificate as an mTLS sign-in method, proving possession of the private key by signing the registration challenge.",
      tags: ["mTLS"],
      hidden: true,
    },
  },
  type: VerificationCodeType.MTLS_REGISTRATION_CHALLENGE,
  requestBody: yupObject({
    certificate_pem: yupString().defined(),
    signature: yupString().defined(),
    display_name: yupString().optional(),
    code: yupString().defined(),
  }),
  data: yupObject({
    challenge: yupString().defined(),
  }),
  method: yupObject({}),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      id: yupString().defined(),
      fingerprint: yupString().defined(),
    }).defined(),
  }),
  async send() {
    throw new HexclaveAssertionError("send() called on an mTLS registration verification code handler");
  },
  async handler(tenancy, _, { challenge }, { certificate_pem, signature, display_name }, user) {
    if (!tenancy.config.auth.mtls.allowSignIn) {
      throw new KnownErrors.MtlsAuthenticationNotEnabled();
    }
    if (!user) {
      throw new HexclaveAssertionError("mTLS registration requires an authenticated user", { tenancyId: tenancy.id });
    }

    const parsed = parseClientCertificate(certificate_pem);

    // The certificate must be currently valid to register it.
    if (!isCertificateTemporallyValid(parsed)) {
      throw new KnownErrors.MtlsCertificateInvalid("The certificate is expired or not yet valid.");
    }

    // Proof of possession: the registration challenge must be signed by the certificate's private key.
    const possessionVerified = await verifyMtlsChallenge({
      publicKey: parsed.spkiBase64Url,
      keyAlgorithm: parsed.keyAlgorithm,
      challenge,
      signature,
    });
    if (!possessionVerified) {
      throw new KnownErrors.MtlsProofOfPossessionFailed();
    }

    // Optional CA pinning: enforced at registration AND at sign-in (config can change between the two).
    if (tenancy.config.auth.mtls.requireCa) {
      const trustedCaPem = tenancy.config.auth.mtls.trustedCaPem;
      if (!trustedCaPem || !certificateChainsToTrustedCa(certificate_pem, trustedCaPem)) {
        throw new KnownErrors.MtlsCaValidationFailed();
      }
    }

    const prisma = await getPrismaClientForTenancy(tenancy);

    let authMethodId: string;
    try {
      authMethodId = await retryTransaction(prisma, async (tx) => {
        const authMethod = await tx.authMethod.create({
          data: {
            tenancyId: tenancy.id,
            projectUserId: user.id,
            mtlsAuthMethod: {
              create: {
                projectUserId: user.id,
                fingerprint: parsed.fingerprint,
                publicKey: parsed.spkiBase64Url,
                certificatePem: certificate_pem,
                subject: parsed.subject,
                issuer: parsed.issuer,
                serialNumber: parsed.serialNumber,
                keyAlgorithm: parsed.keyAlgorithm,
                signatureAlgorithm: parsed.signatureAlgorithm,
                validFrom: parsed.validFrom,
                validTo: parsed.validTo,
                displayName: display_name || defaultDisplayName(parsed.subject, parsed.fingerprint),
              },
            },
          },
          select: { id: true },
        });
        return authMethod.id;
      });
    } catch (e) {
      if (isPrismaUniqueConstraintViolation(e, "MtlsAuthMethod", ["tenancyId", "fingerprint"])) {
        throw new KnownErrors.MtlsCertificateAlreadyRegistered();
      }
      throw e;
    }

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        id: authMethodId,
        fingerprint: parsed.fingerprint,
      },
    };
  },
});
