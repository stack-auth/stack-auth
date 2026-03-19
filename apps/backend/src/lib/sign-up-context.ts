import { yupBoolean, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { SignUpAuthMethod } from "@stackframe/stack-shared/dist/utils/auth-methods";
import { BestEffortEndUserRequestContext } from "./end-users";
import { SignUpTurnstileAssessment } from "./turnstile";
import { SignUpRuleOptions } from "./users";

export const storedSignUpRequestContextSchemaFields = {
  sign_up_ip_address: yupString().nullable().defined(),
  sign_up_ip_trusted: yupBoolean().nullable().defined(),
  sign_up_country_code: yupString().nullable().defined(),
} as const;

export type StoredSignUpRequestContext = {
  sign_up_ip_address: string | null,
  sign_up_ip_trusted: boolean | null,
  sign_up_country_code: string | null,
};

export function serializeStoredSignUpRequestContext(requestContext: BestEffortEndUserRequestContext): StoredSignUpRequestContext {
  return {
    sign_up_ip_address: requestContext.ipAddress,
    sign_up_ip_trusted: requestContext.ipTrusted,
    sign_up_country_code: requestContext.location?.countryCode ?? null,
  };
}

export function deserializeStoredSignUpRequestContext(data: StoredSignUpRequestContext): BestEffortEndUserRequestContext | null {
  if (data.sign_up_ip_address == null && data.sign_up_ip_trusted == null && data.sign_up_country_code == null) {
    return null;
  }

  return {
    ipAddress: data.sign_up_ip_address,
    ipTrusted: data.sign_up_ip_trusted,
    location: data.sign_up_country_code == null ? null : {
      countryCode: data.sign_up_country_code,
    },
  };
}

/**
 * Builds a `SignUpRuleOptions` from a request context and auth details.
 * Centralises the boilerplate that every auth route previously duplicated.
 */
export function buildSignUpRuleOptions(params: {
  authMethod: SignUpAuthMethod,
  oauthProvider: string | null,
  requestContext: BestEffortEndUserRequestContext | null,
  turnstileAssessment: SignUpTurnstileAssessment,
}): SignUpRuleOptions {
  return {
    authMethod: params.authMethod,
    oauthProvider: params.oauthProvider,
    ipAddress: params.requestContext?.ipAddress ?? null,
    ipTrusted: params.requestContext?.ipTrusted ?? null,
    countryCode: params.requestContext?.location?.countryCode ?? null,
    requestContext: params.requestContext,
    turnstileAssessment: params.turnstileAssessment,
  };
}

/**
 * Reconstructs a `SignUpTurnstileAssessment` from stored status/result values.
 * Used in OAuth callbacks and OTP verification where the assessment was serialized.
 */
export function reconstructTurnstileAssessment(
  status: SignUpTurnstileAssessment["status"],
  visibleChallengeResult?: SignUpTurnstileAssessment["visibleChallengeResult"],
): SignUpTurnstileAssessment {
  if (visibleChallengeResult != null) {
    return { status, visibleChallengeResult };
  }
  return { status };
}
