import { AiProxyBodyProcessor } from "@/lib/ai/proxy-preprocessing";
import { SignUpRiskEngine } from "@/lib/risk-scores";
import { createNeutralSignUpHeuristicFacts } from "@/lib/sign-up-heuristics";
import type { SmtpEgressPolicyResult } from "../types";

export const signUpRiskEngine: SignUpRiskEngine = {
  async calculateRiskAssessment() {
    return {
      scores: { bot: 0, free_trial_abuse: 0 },
      heuristicFacts: createNeutralSignUpHeuristicFacts(new Date()),
    };
  },
};

export const preprocessProxyBody: AiProxyBodyProcessor = ({ parsedBody }) => parsedBody;

export async function checkSmtpEgressPolicy(options: {
  host: string,
  port: number,
}): Promise<SmtpEgressPolicyResult> {
  return {
    status: "ok",
    addresses: [options.host],
  };
}
