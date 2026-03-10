import { isIpAddress } from "@stackframe/stack-shared/utils/ips";
import { StackAssertionError } from "@stackframe/stack-shared/utils/errors";
import { normalizeEmail } from "./emails";

type EmailProviderRule = {
  canonicalDomain: string,
  stripPlusTag: boolean,
  stripDots: boolean,
};

const emailProviderRules = new Map<string, EmailProviderRule>([
  ["gmail.com", { canonicalDomain: "gmail.com", stripPlusTag: true, stripDots: true }],
  ["googlemail.com", { canonicalDomain: "gmail.com", stripPlusTag: true, stripDots: true }],
  ["outlook.com", { canonicalDomain: "outlook.com", stripPlusTag: true, stripDots: false }],
  ["hotmail.com", { canonicalDomain: "hotmail.com", stripPlusTag: true, stripDots: false }],
  ["live.com", { canonicalDomain: "live.com", stripPlusTag: true, stripDots: false }],
  ["msn.com", { canonicalDomain: "msn.com", stripPlusTag: true, stripDots: false }],
  ["icloud.com", { canonicalDomain: "icloud.com", stripPlusTag: true, stripDots: false }],
  ["me.com", { canonicalDomain: "icloud.com", stripPlusTag: true, stripDots: false }],
  ["mac.com", { canonicalDomain: "icloud.com", stripPlusTag: true, stripDots: false }],
  ["fastmail.com", { canonicalDomain: "fastmail.com", stripPlusTag: true, stripDots: false }],
]);

export type DerivedSignUpHeuristicFacts = {
  signUpHeuristicRecordedAt: Date,
  signUpIp: string | null,
  signUpIpTrusted: boolean | null,
  signUpEmailNormalized: string | null,
  signUpEmailBase: string | null,
  emailNormalized: string | null,
  emailBase: string | null,
};

export function normalizeSignUpHeuristicIp(ipAddress: string | null): string | null {
  if (ipAddress == null) {
    return null;
  }

  const normalized = ipAddress.trim().toLowerCase();
  if (!isIpAddress(normalized)) {
    throw new StackAssertionError("Expected sign-up heuristic IP address to already be valid", { ipAddress });
  }

  return normalized;
}

function normalizeEmailParts(primaryEmail: string | null): { localPart: string, domain: string } | null {
  if (primaryEmail == null) {
    return null;
  }

  const normalized = normalizeEmail(primaryEmail);
  const atIndex = normalized.indexOf("@");
  if (atIndex < 0) {
    throw new StackAssertionError("normalizeEmail returned an invalid address shape", { primaryEmail, normalized });
  }
  const localPart = normalized.slice(0, atIndex);
  const domain = normalized.slice(atIndex + 1);

  return { localPart, domain };
}

export function normalizeEmailForSignUpHeuristics(primaryEmail: string | null): string | null {
  const parts = normalizeEmailParts(primaryEmail);
  if (parts == null) {
    return null;
  }

  const providerRule = emailProviderRules.get(parts.domain);
  const canonicalDomain = providerRule?.canonicalDomain ?? parts.domain;

  let canonicalLocalPart = parts.localPart;
  if (providerRule?.stripPlusTag) {
    canonicalLocalPart = canonicalLocalPart.split("+")[0] ?? canonicalLocalPart;
  }
  if (providerRule?.stripDots) {
    canonicalLocalPart = canonicalLocalPart.replace(/\./g, "");
  }

  return `${canonicalLocalPart}@${canonicalDomain}`;
}

export function getBaseEmailForSignUpHeuristics(primaryEmail: string | null): string | null {
  const parts = normalizeEmailParts(primaryEmail);
  if (parts == null) {
    return null;
  }

  const canonicalDomain = emailProviderRules.get(parts.domain)?.canonicalDomain ?? parts.domain;

  let templateLocalPart = parts.localPart.replace(/[._-]+/g, "-");
  templateLocalPart = templateLocalPart.replace(/\+\d+$/g, "");
  templateLocalPart = templateLocalPart.replace(/-\d+$/g, "");
  templateLocalPart = templateLocalPart.replace(/\d+$/g, "");
  templateLocalPart = templateLocalPart.replace(/-+/g, "-").replace(/^-|-$/g, "");

  if (templateLocalPart === "") {
    templateLocalPart = parts.localPart;
  }

  return `${templateLocalPart}@${canonicalDomain}`;
}

export function deriveSignUpHeuristicFacts(params: {
  primaryEmail: string | null,
  ipAddress: string | null,
  ipTrusted: boolean | null,
  recordedAt?: Date,
}): DerivedSignUpHeuristicFacts {
  const recordedAt = params.recordedAt ?? new Date();
  const normalizedIp = normalizeSignUpHeuristicIp(params.ipAddress);
  const emailNormalized = normalizeEmailForSignUpHeuristics(params.primaryEmail);
  const emailBase = getBaseEmailForSignUpHeuristics(params.primaryEmail);

  return {
    signUpHeuristicRecordedAt: recordedAt,
    signUpIp: normalizedIp,
    signUpIpTrusted: normalizedIp == null ? null : params.ipTrusted,
    signUpEmailNormalized: emailNormalized,
    signUpEmailBase: emailBase,
    emailNormalized,
    emailBase,
  };
}

import.meta.vitest?.test("normalizeEmailForSignUpHeuristics(...)", ({ expect }) => {
  const localPartCases = [
    { localPart: "Example.Test+123", expectedByDomain: new Map([
      ["googlemail.com", "exampletest@gmail.com"],
      ["gmail.com", "exampletest@gmail.com"],
      ["outlook.com", "example.test@outlook.com"],
      ["example.com", "example.test+123@example.com"],
    ]) },
    { localPart: "Jane.Doe", expectedByDomain: new Map([
      ["googlemail.com", "janedoe@gmail.com"],
      ["gmail.com", "janedoe@gmail.com"],
      ["outlook.com", "jane.doe@outlook.com"],
      ["example.com", "jane.doe@example.com"],
    ]) },
  ];

  for (const localPartCase of localPartCases) {
    for (const [domain, expected] of localPartCase.expectedByDomain) {
      expect(normalizeEmailForSignUpHeuristics(`${localPartCase.localPart}@${domain}`)).toBe(expected);
    }
  }

  expect(normalizeEmailForSignUpHeuristics(null)).toBeNull();
});

import.meta.vitest?.test("getBaseEmailForSignUpHeuristics(...)", ({ expect }) => {
  const baseLocalPart = "alice";
  const noisySuffixes = ["+1", "+2", "-3", "_004", ".005", "--006"];
  for (const suffix of noisySuffixes) {
    expect(getBaseEmailForSignUpHeuristics(`${baseLocalPart}${suffix}@example.com`)).toBe("alice@example.com");
  }

  const preservedAliasCases = ["alice+sales@example.com", "alice+team@example.com"];
  for (const preservedAliasCase of preservedAliasCases) {
    expect(getBaseEmailForSignUpHeuristics(preservedAliasCase)).toBe(preservedAliasCase);
  }
});

import.meta.vitest?.test("deriveSignUpHeuristicFacts(...)", ({ expect }) => {
  const recordedAt = new Date("2026-03-10T00:00:00.000Z");
  const cases = [
    {
      primaryEmail: "alice+1@example.com",
      ipAddress: " 127.0.0.1 ",
      ipTrusted: false,
      expected: {
        signUpIp: "127.0.0.1",
        signUpIpTrusted: false,
        signUpEmailNormalized: "alice+1@example.com",
        signUpEmailBase: "alice@example.com",
      },
    },
    {
      primaryEmail: "Example.Test+123@googlemail.com",
      ipAddress: null,
      ipTrusted: true,
      expected: {
        signUpIp: null,
        signUpIpTrusted: null,
        signUpEmailNormalized: "exampletest@gmail.com",
        signUpEmailBase: "example-test@gmail.com",
      },
    },
  ];

  for (const testCase of cases) {
    expect(deriveSignUpHeuristicFacts({
      primaryEmail: testCase.primaryEmail,
      ipAddress: testCase.ipAddress,
      ipTrusted: testCase.ipTrusted,
      recordedAt,
    })).toMatchObject({
      signUpHeuristicRecordedAt: recordedAt,
      ...testCase.expected,
      emailNormalized: testCase.expected.signUpEmailNormalized,
      emailBase: testCase.expected.signUpEmailBase,
    });
  }
});
