import { certificateChainsToTrustedCa, isCertificateTemporallyValid, parseClientCertificate } from "@/lib/mtls";
import { createAuthTokens } from "@/lib/tokens";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createVerificationCodeHandler } from "@/route-handlers/verification-code-handler";
import { VerificationCodeType } from "@/generated/prisma/client";
import { KnownErrors } from "@hexclave/shared";
import { signInResponseSchema, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";
import { isMtlsKeyAlgorithm, verifyMtlsChallenge } from "@hexclave/shared/dist/utils/mtls";
import { createMfaRequiredError } from "../../mfa/sign-in/verification-code-handler";

export const mtlsSignInVerificationCodeHandler = createVerificationCodeHandler({
  metadata: {
    post: {
      summary: "Sign in with a client certificate",
      description: "Sign in by proving possession of a registered X.509 client certificate's private key.",
      tags: ["mTLS"],
      hidden: true,
    },
  },
  type: VerificationCodeType.MTLS_AUTHENTICATION_CHALLENGE,
  requestBody: yupObject({
    certificate_pem: yupString().defined(),
    signature: yupString().defined(),
    code: yupString().defined(),
  }),
  data: yupObject({
    challenge: yupString().defined(),
  }),
  method: yupObject({}),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: signInResponseSchema.defined(),
  }),
  async send() {
    throw new HexclaveAssertionError("send() called on an mTLS sign-in verification code handler");
  },
  async handler(tenancy, _, { challenge }, { certificate_pem, signature }, _user, apiUrl) {
    if (!tenancy.config.auth.mtls.allowSignIn) {
      throw new KnownErrors.MtlsAuthenticationNotEnabled();
    }

    // Recompute the fingerprint server-side from the submitted certificate (never trust a client-sent
    // fingerprint) and look up the registered credential by it.
    const parsed = parseClientCertificate(certificate_pem);

    const prisma = await getPrismaClientForTenancy(tenancy);
    const mtlsAuthMethod = await prisma.mtlsAuthMethod.findUnique({
      where: {
        tenancyId_fingerprint: {
          tenancyId: tenancy.id,
          fingerprint: parsed.fingerprint,
        },
      },
      include: { projectUser: true },
    });

    if (!mtlsAuthMethod) {
      throw new KnownErrors.MtlsAuthenticationFailed("This certificate is not registered.");
    }

    if (!isCertificateTemporallyValid({ validFrom: mtlsAuthMethod.validFrom, validTo: mtlsAuthMethod.validTo })) {
      throw new KnownErrors.MtlsAuthenticationFailed("The certificate has expired.");
    }

    // Re-check CA pinning at sign-in: the project may have enabled `requireCa` (or changed the trusted CA)
    // after this certificate was registered, so a stored "valid at registration" flag would be unsafe.
    if (tenancy.config.auth.mtls.requireCa) {
      const trustedCaPem = tenancy.config.auth.mtls.trustedCaPem;
      if (!trustedCaPem || !certificateChainsToTrustedCa(mtlsAuthMethod.certificatePem, trustedCaPem)) {
        throw new KnownErrors.MtlsCaValidationFailed();
      }
    }

    // Verify the challenge signature against the STORED public key (the registered credential), not the
    // submitted certificate's key. The fingerprint match already guarantees they are identical, but
    // trusting the database is the defensive choice.
    if (!isMtlsKeyAlgorithm(mtlsAuthMethod.keyAlgorithm)) {
      throw new HexclaveAssertionError("Stored mTLS key algorithm is not a recognized value", { keyAlgorithm: mtlsAuthMethod.keyAlgorithm });
    }
    const signatureVerified = await verifyMtlsChallenge({
      publicKey: mtlsAuthMethod.publicKey,
      keyAlgorithm: mtlsAuthMethod.keyAlgorithm,
      challenge,
      signature,
    });
    if (!signatureVerified) {
      throw new KnownErrors.MtlsAuthenticationFailed("The challenge signature could not be verified with the registered certificate's public key.");
    }

    const user = mtlsAuthMethod.projectUser;

    if (user.requiresTotpMfa) {
      throw await createMfaRequiredError({
        project: tenancy.project,
        branchId: tenancy.branchId,
        isNewUser: false,
        userId: user.projectUserId,
      });
    }

    const { refreshToken, accessToken } = await createAuthTokens({
      tenancy,
      projectUserId: user.projectUserId,
      apiUrl,
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        refresh_token: refreshToken,
        access_token: accessToken,
        is_new_user: false,
        user_id: user.projectUserId,
      },
    };
  },
});
