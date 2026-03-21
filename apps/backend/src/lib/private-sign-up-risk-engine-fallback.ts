import { createNeutralSignUpHeuristicFacts } from "./sign-up-heuristics";

console.debug("[risk-scores] Private sign-up risk engine not found during build; compiling zero-score fallback");

export const signUpRiskEngine = {
  async calculateRiskAssessment() {
    return {
      scores: { bot: 0, free_trial_abuse: 0 },
      heuristicFacts: createNeutralSignUpHeuristicFacts(new Date()),
    };
  },
};
