import { SignUpRiskEngine } from "@/lib/risk-scores";
import { createNeutralSignUpHeuristicFacts } from "@/lib/sign-up-heuristics";

export const signUpRiskEngine: SignUpRiskEngine = {
  async calculateRiskAssessment() {
    return {
      scores: { bot: 0, free_trial_abuse: 0 },
      heuristicFacts: createNeutralSignUpHeuristicFacts(new Date()),
    };
  },
};
