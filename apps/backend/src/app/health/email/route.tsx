import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { traceSpan } from "@/utils/telemetry";
import { yupNumber, yupObject, yupString, yupTuple } from "@stackframe/stack-shared/dist/schema-fields";
import { generateSecureRandomString } from "@stackframe/stack-shared/dist/utils/crypto";
import { getEnvVariable, getNodeEnvironment } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError, StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { wait } from "@stackframe/stack-shared/dist/utils/promises";

type ResendEmail = {
  to: string[],
  subject: string,
  from: string,
  created_at: string,
};

type InbucketMessage = {
  id: string,
  subject: string,
  from: string,
  to: string[],
  date: string,
};

const transformInbucketToResendFormat = (messages: InbucketMessage[]): { data: ResendEmail[] } => {
  return {
    data: messages.map(msg => ({
      to: msg.to,
      subject: msg.subject,
      from: msg.from,
      created_at: msg.date,
    })),
  };
};

const fetchFromInbucket = async (testEmail: string): Promise<{ data: ResendEmail[] }> => {
  const inbucketUrl = getEnvVariable("STACK_EMAIL_MONITOR_INBUCKET_API_URL");
  const mailboxName = testEmail.split("@")[0];

  const response = await fetch(`${inbucketUrl}/api/v1/mailbox/${encodeURIComponent(mailboxName)}`);
  if (!response.ok) {
    return { data: [] };
  }

  const messages = await response.json() as InbucketMessage[];
  return transformInbucketToResendFormat(messages);
};

const fetchFromResend = async (): Promise<{ data: ResendEmail[] }> => {
  const resendApiKey = getEnvVariable("STACK_EMAIL_MONITOR_RESEND_EMAIL_API_KEY");
  const response = await fetch("https://api.resend.com/emails/receiving", {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    return { data: [] };
  }

  return await response.json();
};

const performSignUp = async (email: string, password: string) => {
  await traceSpan("performing sign-up", async () => {
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
  });
};

const isExpectedVerificationEmail = (email: ResendEmail, testEmail: string): boolean => {
  const EXPECTED_EMAIL_SUBJECT_CONTAINS = "verify";

  // Inbucket wraps emails in angle brackets like "<email@example.com>"
  const matchesRecipient = email.to.some(to => to.includes(testEmail));
  const matchesSubject = email.subject.toLowerCase().includes(EXPECTED_EMAIL_SUBJECT_CONTAINS.toLowerCase());
  // Skip sender check - in dev it's example.com, in prod it's stackframe.co

  return matchesRecipient && matchesSubject;
};

const waitForVerificationEmail = async (testEmail: string, useInbucket: boolean) => {
  await traceSpan("waiting for verification email", async () => {
    const MAX_POLL_ATTEMPTS = 24;
    const POLL_INTERVAL_MS = 5000;

    for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
      await traceSpan(`waiting for verification email - attempt ${attempt}`, async () => {
        await wait(POLL_INTERVAL_MS);

        const listData = useInbucket
          ? await fetchFromInbucket(testEmail)
          : await fetchFromResend();

        const emails = listData.data;
        const verificationEmail = emails.find((email) => isExpectedVerificationEmail(email, testEmail));

        if (verificationEmail) {
          return;
        }
      });
    }

    throw new StackAssertionError(`Couldn't find verification email in time limit`, { recipient_email: testEmail, max_poll_attempts: MAX_POLL_ATTEMPTS, poll_interval_ms: POLL_INTERVAL_MS });
  });
};

export const POST = createSmartRouteHandler({
  metadata: {
    hidden: true,
    summary: "Email Health Monitor",
    description: "Tests the sign-up + email verification flow. Returns 200 if successful.",
    tags: ["Monitoring"],
  },
  request: yupObject({
    headers: yupObject({
      "authorization": yupTuple([yupString()]).defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["success"]).defined(),
  }),
  handler: async ({ headers }) => {
    const authHeader = headers.authorization[0];
    if (authHeader !== `Bearer ${getEnvVariable("STACK_EMAIL_MONITOR_SECRET_TOKEN")}`) {
      throw new StatusError(401, "Unauthorized");
    }

    const useInbucket = getEnvVariable("STACK_EMAIL_MONITOR_USE_INBUCKET") === "true";
    if (useInbucket && getNodeEnvironment().includes("prod")) {
      throw new StackAssertionError("Inbucket is not supported as the email monitor inbox in production");
    }

    const uniqueId = generateSecureRandomString();
    const testEmail = `monitor+${uniqueId}@${getEnvVariable("STACK_EMAIL_MONITOR_RESEND_EMAIL_DOMAIN")}`;
    const testPassword = generateSecureRandomString();

    await performSignUp(testEmail, testPassword);

    await waitForVerificationEmail(testEmail, useInbucket);

    return {
      statusCode: 200,
      bodyType: "success",
    };
  },
});
