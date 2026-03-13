import { Tenancy } from "./tenancies";

export type SignUpRiskScores = {
  bot: number,
  freeTrialAbuse: number,
};

export type SignUpRiskScoreContext = {
  primaryEmail: string | null,
  primaryEmailVerified: boolean,
  authMethod: 'password' | 'otp' | 'oauth' | 'passkey',
  oauthProvider?: string,
  ipAddress: string | null,
};

export async function calculateSignUpRiskScores(tenancy: Tenancy, context: SignUpRiskScoreContext): Promise<SignUpRiskScores> {
  // TODO
  if (context.primaryEmail === "test@example.com") {
    return {
      bot: 100,
      freeTrialAbuse: 100,
    };
  } else {
    return {
      bot: 0,
      freeTrialAbuse: 0,
    };
  }
}
