export const GROWTH_INTERVIEW_OTHER_OPTION_ID = "other";

export type GrowthInterviewOptionInput = { id: string, label: string, description?: string | undefined };

export type GrowthInterviewStoredOption = { id: string, label: string, description: string | undefined };

export function withGrowthInterviewOtherOption(options: GrowthInterviewOptionInput[]): GrowthInterviewStoredOption[] {
  const existingOther = options.find((option) => option.id.toLowerCase() === GROWTH_INTERVIEW_OTHER_OPTION_ID);
  return [
    ...options
      .filter((option) => option.id.toLowerCase() !== GROWTH_INTERVIEW_OTHER_OPTION_ID)
      .map((option) => ({ id: option.id, label: option.label, description: option.description })),
    { id: GROWTH_INTERVIEW_OTHER_OPTION_ID, label: "Other", description: existingOther?.description ?? "Write your own answer" },
  ];
}
