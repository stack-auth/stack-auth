import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { generateSecureRandomString } from "@stackframe/stack-shared/dist/utils/crypto";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { wait } from "@stackframe/stack-shared/dist/utils/promises";

type ResendEmail = {
  to: string[],
  subject: string,
  from: string,
  created_at: string,
};

const performSignUp = async (email: string, password: string) => {
  const apiBaseUrl = getEnvVariable("NEXT_PUBLIC_STACK_API_URL");
  const response = await fetch(`${apiBaseUrl}/api/v1/auth/password/sign-up`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Stack-Access-Type": "client",
      "X-Stack-Publishable-Client-Key": getEnvVariable("STACK_EMAIL_MONITOR_PUBLISHABLE_CLIENT_KEY"),
      "X-Stack-Project-Id": getEnvVariable("STACK_EMAIL_MONITOR_PROJECT_ID"),
    },
    body: JSON.stringify({
      email,
      password,
      verification_callback_url: getEnvVariable("STACK_EMAIL_MONITOR_VERIFICATION_CALLBACK_URL"),
    }),
  });

  const responseBody = await response.text();

  if (!response.ok) {
    throw new StackAssertionError(`Sign-up failed: ${response.status} - ${responseBody}`, {
      responseBody,
    });
  }
};

const isExpectedVerificationEmail =(email: ResendEmail, testEmail: string): boolean => {
  const EXPECTED_EMAIL_SUBJECT_CONTAINS = "verify";
  const EXPECTED_EMAIL_FROM_CONTAINS = "stackframe.co";

  const matchesRecipient = email.to.includes(testEmail);
  const matchesSubject = email.subject.toLowerCase().includes(EXPECTED_EMAIL_SUBJECT_CONTAINS.toLowerCase());
  const matchesSender = email.from.toLowerCase().includes(EXPECTED_EMAIL_FROM_CONTAINS.toLowerCase());

  return matchesRecipient && matchesSubject && matchesSender;
};

const waitForVerificationEmail =async (testEmail: string) => {
  const resendApiKey = getEnvVariable("STACK_EMAIL_MONITOR_RESEND_EMAIL_API_KEY");

  const MAX_POLL_ATTEMPTS = 24;
  const POLL_INTERVAL_MS = 5000;

  const RESEND_API_URL = "https://api.resend.com/emails/receiving";
  for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
    await wait(POLL_INTERVAL_MS);

    const listResponse = await fetch(RESEND_API_URL, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
    });

    if (!listResponse.ok) {
      continue;
    }

    const listData = await listResponse.json();
    const emails = (listData?.data ?? []) as ResendEmail[];
    const verificationEmail = emails.find((email) => isExpectedVerificationEmail(email, testEmail));

    if (verificationEmail) {
      return;
    }
  }

  throw new StackAssertionError(`Couldn't find verification email in time limit`, { recipient_email: testEmail, max_poll_attempts: MAX_POLL_ATTEMPTS, poll_interval_ms: POLL_INTERVAL_MS });
};

export const GET = createSmartRouteHandler({
  metadata: {
    hidden: true,
    summary: "Email Health Monitor",
    description: "Tests the sign-up + email verification flow. Returns 200 if successful.",
    tags: ["Monitoring"],
  },
  request: yupObject({}),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      status: yupString().oneOf(["ok"]).defined(),
      message: yupString().defined(),
    }).defined(),
  }),
  handler: async () => {
    const uniqueId = generateSecureRandomString();
    const testEmail = `monitor+${uniqueId}@${getEnvVariable("STACK_EMAIL_MONITOR_RESEND_EMAIL_DOMAIN")}`;
    const testPassword = generateSecureRandomString();

    await performSignUp(testEmail, testPassword);

    await waitForVerificationEmail(testEmail);

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        status: "ok",
        message: "Sign-up and sending of verification email successful",
      },
    };
  },
});
