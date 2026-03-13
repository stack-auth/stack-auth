export type DerivedSignUpHeuristicFacts = {
  signedUpAt: Date,
  signUpIp: string | null,
  signUpIpTrusted: boolean | null,
  signUpEmailNormalized: string | null,
  signUpEmailBase: string | null,
  emailNormalized: string | null,
  emailBase: string | null,
};

export function createNeutralSignUpHeuristicFacts(recordedAt: Date = new Date()): DerivedSignUpHeuristicFacts {
  return {
    signedUpAt: recordedAt,
    signUpIp: null,
    signUpIpTrusted: null,
    signUpEmailNormalized: null,
    signUpEmailBase: null,
    emailNormalized: null,
    emailBase: null,
  };
}

import.meta.vitest?.test("createNeutralSignUpHeuristicFacts(...)", ({ expect }) => {
  const recordedAt = new Date("2026-03-11T00:00:00.000Z");

  expect(createNeutralSignUpHeuristicFacts(recordedAt)).toEqual({
    signedUpAt: recordedAt,
    signUpIp: null,
    signUpIpTrusted: null,
    signUpEmailNormalized: null,
    signUpEmailBase: null,
    emailNormalized: null,
    emailBase: null,
  });
});
