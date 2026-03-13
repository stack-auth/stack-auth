import { SignUpAuthMethod } from "@stackframe/stack-shared/dist/utils/auth-methods";
import { BestEffortEndUserRequestContext } from "./end-users";
import { SignUpTurnstileAssessment } from "./turnstile";
import { SignUpRuleOptions } from "./users";

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
