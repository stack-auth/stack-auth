export type GtmOnboardingInput = {
  domain: string,
  phone: string,
  notes: string,
};

export function validateGtmOnboardingInput(input: GtmOnboardingInput): string | null {
  if (input.domain.trim().length > 0) {
    try {
      const domain = new URL(input.domain);
      if ((domain.protocol !== "https:" && domain.protocol !== "http:") || domain.hostname.length === 0) {
        return "Use a complete website URL, beginning with http:// or https://.";
      }
    } catch {
      return "Use a complete website URL, beginning with http:// or https://.";
    }
  }
  if (!/^[+0-9(). -]+$/.test(input.phone.trim()) || input.phone.trim().length < 7) {
    return "Add a phone number so our team can reach you.";
  }
  if (input.notes.trim().length > 2000) return "Keep your notes to 2,000 characters or fewer.";
  return null;
}
