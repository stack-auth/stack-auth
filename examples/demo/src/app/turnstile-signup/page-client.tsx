'use client';

import { KnownErrors } from "@stackframe/stack-shared";
import type { TurnstileRetryResult } from "@stackframe/stack-shared/dist/utils/turnstile";
import { turnstileDevelopmentKeys } from "@stackframe/stack-shared/dist/utils/turnstile";
import { useStackApp, useTurnstileAuth, useUser } from "@stackframe/stack";
import { Button, Card, CardContent, CardFooter, CardHeader, Input, Label, PasswordInput, Typography } from "@stackframe/stack-ui";
import Link from "next/link";
import { useState } from "react";
import { TurnstileVisibleWidget } from "src/components/turnstile-visible-widget";

const forcedChallengeSiteKey = process.env.NEXT_PUBLIC_STACK_TURNSTILE_ALWAYS_CHALLENGE_SITE_KEY || turnstileDevelopmentKeys.forcedChallengeSiteKey;
const invisibleTurnstileSiteKey = process.env.NEXT_PUBLIC_STACK_TURNSTILE_INVISIBLE_SITE_KEY || turnstileDevelopmentKeys.invisibleSiteKey;
const sharedTurnstileSiteKey = process.env.NEXT_PUBLIC_STACK_TURNSTILE_SITE_KEY || turnstileDevelopmentKeys.visibleSiteKey;
const forcedChallengeSiteKeySource = process.env.NEXT_PUBLIC_STACK_TURNSTILE_ALWAYS_CHALLENGE_SITE_KEY
  ? "NEXT_PUBLIC_STACK_TURNSTILE_ALWAYS_CHALLENGE_SITE_KEY"
  : "built-in Cloudflare interactive test key";

function createSuggestedEmail() {
  const suffix = crypto.randomUUID().slice(0, 8);
  return `turnstile-demo+${suffix}@example.com`;
}

const demoInvisibleTokens = {
  success: "mock-turnstile-ok:sign_up_with_credential",
  invalid: "mock-turnstile-invalid",
} as const;

type SubmissionFlow = "invisible-ok" | "invisible-invalid" | "visible-retry" | "visible-fail" | "no-token";

type SubmissionResult = {
  flow: SubmissionFlow,
  status: "success" | "error" | "info",
  message: string,
};

type WrapperResult = {
  status: "success" | "error" | "info",
  message: string,
};

type VisibleFallbackState = {
  previousTurnstileResult: TurnstileRetryResult,
};

export default function TurnstileSignupPageClient() {
  const app = useStackApp();
  const user = useUser();
  const turnstile = useTurnstileAuth({
    action: "sign_up_with_credential",
    missingVisibleChallengeMessage: "Please solve the visible fallback challenge before retrying",
    challengeRequiredMessage: "Turnstile requested a visible fallback challenge. Solve it below and submit again.",
  });
  const [email, setEmail] = useState(() => createSuggestedEmail());
  const [password, setPassword] = useState("Demo-password-123!");
  const [wrapperLoading, setWrapperLoading] = useState(false);
  const [wrapperResult, setWrapperResult] = useState<WrapperResult | null>(null);
  const [loadingFlow, setLoadingFlow] = useState<SubmissionFlow | null>(null);
  const [submissionResult, setSubmissionResult] = useState<SubmissionResult | null>(null);
  const [visibleFallbackState, setVisibleFallbackState] = useState<VisibleFallbackState | null>(null);
  const [visibleTurnstileToken, setVisibleTurnstileToken] = useState<string | null>(null);
  const [visibleTurnstileError, setVisibleTurnstileError] = useState<string | null>(null);
  const [challengeWidgetKey, setChallengeWidgetKey] = useState(0);

  if (user != null) {
    return (
      <div className="container mx-auto p-6 max-w-4xl">
        <Card>
          <CardHeader>
            <Typography type="h2">Turnstile Signup Demo</Typography>
          </CardHeader>
          <CardContent className="space-y-3">
            <Typography>
              You are currently signed in as <span className="font-mono">{user.primaryEmail ?? user.id}</span>.
            </Typography>
            <Typography className="text-sm text-gray-600 dark:text-gray-300">
              Sign out first to rerun the invisible-first signup flow from a clean state.
            </Typography>
          </CardContent>
          <CardFooter className="flex gap-3">
            <Button onClick={async () => await user.signOut({ redirectUrl: "/turnstile-signup" })}>
              Sign out and retry
            </Button>
            <Link href="/" className="inline-flex items-center rounded-md border px-4 py-2 text-sm font-medium">
              Back to home
            </Link>
          </CardFooter>
        </Card>
      </div>
    );
  }

  async function submitWrapperFlow() {
    setWrapperLoading(true);
    setWrapperResult(null);

    try {
      const turnstileResult = await turnstile.run(async (turnstileFlowOptions) => await app.signUpWithCredential({
        email,
        password,
        noRedirect: true,
        noVerificationCallback: true,
        ...turnstileFlowOptions,
      }));

      if (turnstileResult.status === "blocked") {
        setWrapperResult({
          status: "info",
          message: "The recommended custom-component flow is waiting for the visible fallback challenge. Solve it below and submit again.",
        });
        return;
      }

      const result = turnstileResult.result;
      if (result.status === "error") {
        setWrapperResult({
          status: "error",
          message: result.error.message,
        });
        return;
      }

      setWrapperResult({
        status: "success",
        message: "Signup succeeded through the recommended useTurnstileAuth wrapper flow.",
      });
    } finally {
      setWrapperLoading(false);
    }
  }

  async function submitInvisibleAttempt(params: {
    flow: "invisible-ok" | "invisible-invalid",
    token: string,
  }) {
    setLoadingFlow(params.flow);
    setSubmissionResult(null);
    setVisibleFallbackState(null);
    setVisibleTurnstileToken(null);
    setVisibleTurnstileError(null);
    setChallengeWidgetKey((current) => current + 1);

    try {
      const result = await app.signUpWithCredential({
        email,
        password,
        noRedirect: true,
        noVerificationCallback: true,
        turnstileToken: params.token,
        turnstilePhase: "invisible",
      });

      if (result.status === "error") {
        if (KnownErrors.TurnstileChallengeRequired.isInstance(result.error)) {
          const [previousTurnstileResult] = result.error.constructorArgs;
          setVisibleFallbackState({ previousTurnstileResult });
          setSubmissionResult({
            flow: params.flow,
            status: "info",
            message: `The invisible attempt returned ${previousTurnstileResult}. Solve the visible fallback challenge below to finish signup.`,
          });
          return;
        }

        setSubmissionResult({
          flow: params.flow,
          status: "error",
          message: result.error.message,
        });
        return;
      }

      setSubmissionResult({
        flow: params.flow,
        status: "success",
        message: "Signup succeeded directly from the invisible-first attempt.",
      });
    } finally {
      setLoadingFlow(null);
    }
  }

  async function completeVisibleFallbackSignup() {
    setLoadingFlow("visible-retry");
    setSubmissionResult(null);

    try {
      if (visibleFallbackState == null) {
        setSubmissionResult({
          flow: "visible-retry",
          status: "error",
          message: "Run the invisible-invalid step first so the backend requests a visible fallback challenge.",
        });
        return;
      }

      if (visibleTurnstileToken == null) {
        setVisibleTurnstileError("Complete the visible Turnstile challenge first.");
        return;
      }

      const result = await app.signUpWithCredential({
        email,
        password,
        noRedirect: true,
        noVerificationCallback: true,
        turnstileToken: visibleTurnstileToken,
        turnstilePhase: "visible",
        previousTurnstileResult: visibleFallbackState.previousTurnstileResult,
      });

      if (result.status === "error") {
        if (KnownErrors.TurnstileChallengeRequired.isInstance(result.error)) {
          setVisibleTurnstileToken(null);
          setVisibleTurnstileError("The visible fallback token failed verification. Solve the challenge again.");
          setChallengeWidgetKey((current) => current + 1);
          setSubmissionResult({
            flow: "visible-retry",
            status: "error",
            message: "The backend still requires a valid visible challenge token.",
          });
          return;
        }

        setSubmissionResult({
          flow: "visible-retry",
          status: "error",
          message: result.error.message,
        });
        return;
      }

      setSubmissionResult({
        flow: "visible-retry",
        status: "success",
        message: "Signup succeeded after the visible fallback challenge. The backend should persist the softened recovered Turnstile risk score for this signup.",
      });
    } finally {
      setLoadingFlow(null);
    }
  }

  async function submitVisibleFailAttempt() {
    setLoadingFlow("visible-fail");
    setSubmissionResult(null);
    setVisibleFallbackState(null);
    setVisibleTurnstileToken(null);
    setVisibleTurnstileError(null);
    setChallengeWidgetKey((current) => current + 1);

    try {
      const result = await app.signUpWithCredential({
        email,
        password,
        noRedirect: true,
        noVerificationCallback: true,
        turnstileToken: demoInvisibleTokens.invalid,
        turnstilePhase: "visible",
        previousTurnstileResult: "invalid",
      });

      if (result.status === "error") {
        setSubmissionResult({
          flow: "visible-fail",
          status: "error",
          message: result.error.message,
        });
        return;
      }

      setSubmissionResult({
        flow: "visible-fail",
        status: "success",
        message: "Signup unexpectedly succeeded even though both Turnstile stages sent invalid tokens.",
      });
    } finally {
      setLoadingFlow(null);
    }
  }

  async function submitNoTokenAttempt() {
    setLoadingFlow("no-token");
    setSubmissionResult(null);
    setVisibleFallbackState(null);
    setVisibleTurnstileToken(null);
    setVisibleTurnstileError(null);
    setChallengeWidgetKey((current) => current + 1);

    try {
      const result = await app.signUpWithCredential({
        email,
        password,
        noRedirect: true,
        noVerificationCallback: true,
      });

      if (result.status === "error") {
        setSubmissionResult({
          flow: "no-token",
          status: "error",
          message: result.error.message,
        });
        return;
      }

      setSubmissionResult({
        flow: "no-token",
        status: "success",
        message: "Signup succeeded without any Turnstile token. The backend accepted the request for backwards compatibility.",
      });
    } finally {
      setLoadingFlow(null);
    }
  }

  return (
    <div className="container mx-auto p-6 max-w-5xl">
      <div className="space-y-6">
        <div className="space-y-2">
          <Typography type="h1">Turnstile Signup Demo</Typography>
          <Typography>
            This page shows both the recommended custom-component wrapper for Turnstile-aware signup and the lower-level debug flows for forcing specific backend outcomes.
          </Typography>
          <Typography className="text-sm text-gray-600 dark:text-gray-300">
            Use the wrapper section first if you want to see the supported custom React API. Use the raw debug section below when you need to force invalid or no-token backend behavior.
          </Typography>
        </div>

        <Card>
          <CardHeader>
            <Typography type="h3">Current Turnstile config</Typography>
          </CardHeader>
          <CardContent className="space-y-2">
            <Typography className="text-sm break-all">
              Hosted fallback / visible site key: <span className="font-mono">{sharedTurnstileSiteKey === "" ? "not set" : sharedTurnstileSiteKey}</span>
            </Typography>
            <Typography className="text-sm break-all">
              Hosted invisible site key: <span className="font-mono">{invisibleTurnstileSiteKey === "" ? "not set" : invisibleTurnstileSiteKey}</span>
            </Typography>
            <Typography className="text-sm break-all">
              Demo visible challenge site key: <span className="font-mono">{forcedChallengeSiteKey}</span> <span className="text-gray-600 dark:text-gray-300">({forcedChallengeSiteKeySource})</span>
            </Typography>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <Typography type="h3">Shared credentials</Typography>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="turnstile-demo-email">Email</Label>
                <Input
                  id="turnstile-demo-email"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    turnstile.clearChallengeError();
                    setWrapperResult(null);
                    setSubmissionResult(null);
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="turnstile-demo-password">Password</Label>
                <PasswordInput
                  id="turnstile-demo-password"
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    turnstile.clearChallengeError();
                    setWrapperResult(null);
                    setSubmissionResult(null);
                  }}
                />
              </div>
            </div>
            <div className="flex gap-3">
              <Button
                variant="secondary"
                onClick={() => {
                  setEmail(createSuggestedEmail());
                  turnstile.clearChallengeError();
                  setWrapperResult(null);
                  setSubmissionResult(null);
                  setVisibleFallbackState(null);
                  setVisibleTurnstileToken(null);
                  setVisibleTurnstileError(null);
                  setChallengeWidgetKey((current) => current + 1);
                }}
              >
                Generate new email
              </Button>
              <Typography className="text-sm text-gray-600 dark:text-gray-300">
                The suggested email uses a random local-part so you can repeat the flow without manual cleanup.
              </Typography>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <Typography type="h3">Recommended custom component flow</Typography>
          </CardHeader>
          <CardContent className="space-y-3">
            <Typography>
              This section uses <span className="font-mono">useTurnstileAuth()</span>, the same wrapper custom React auth components should use when Turnstile is enabled.
            </Typography>
            <Typography className="text-sm text-gray-600 dark:text-gray-300">
              It runs the invisible-first signup attempt automatically and shows the visible fallback challenge only when the backend returns <span className="font-mono">TURNSTILE_CHALLENGE_REQUIRED</span>.
            </Typography>
            {wrapperResult != null ? (
              <Typography
                className={
                  wrapperResult.status === "error"
                    ? "text-red-600 dark:text-red-400"
                    : wrapperResult.status === "success"
                      ? "text-green-700 dark:text-green-300"
                      : "text-blue-700 dark:text-blue-300"
                }
              >
                {wrapperResult.message}
              </Typography>
            ) : null}
            {turnstile.challengeError != null ? (
              <Typography className="text-sm text-red-600 dark:text-red-400">
                {turnstile.challengeError}
              </Typography>
            ) : null}
            {turnstile.turnstileWidget}
          </CardContent>
          <CardFooter className="flex gap-3">
            <Button
              loading={wrapperLoading}
              disabled={!turnstile.canSubmit}
              onClick={async () => await submitWrapperFlow()}
            >
              Run wrapper flow
            </Button>
            <Typography className="text-sm text-gray-600 dark:text-gray-300">
              This is the supported abstraction for custom Turnstile-aware signup components.
            </Typography>
          </CardFooter>
        </Card>

        <div className="space-y-2">
          <Typography type="h2">Raw backend-debug flows</Typography>
          <Typography className="text-sm text-gray-600 dark:text-gray-300">
            These sections intentionally bypass the wrapper so you can force exact request payloads and backend outcomes.
          </Typography>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <Typography type="h3">Forced invisible fail to visible fallback</Typography>
            </CardHeader>
            <CardContent className="space-y-3">
              <Typography>
                First sends <span className="font-mono">{demoInvisibleTokens.invalid}</span> to force the invisible attempt into the fallback path.
              </Typography>
              <Typography className="text-sm text-gray-600 dark:text-gray-300">
                Expected backend effect: the first request returns <span className="font-mono">TURNSTILE_CHALLENGE_REQUIRED</span>, and a successful visible retry should persist the reduced recovered penalty instead of the old full invalid score.
              </Typography>
              {visibleFallbackState != null ? (
                <div className="rounded-md border p-4 space-y-3">
                  <Typography className="text-sm">
                    Waiting for visible fallback completion. Previous invisible result: <span className="font-mono">{visibleFallbackState.previousTurnstileResult}</span>
                  </Typography>
                  <TurnstileVisibleWidget
                    key={challengeWidgetKey}
                    siteKey={forcedChallengeSiteKey}
                    action="sign_up_with_credential"
                    onTokenChange={(token) => {
                      setVisibleTurnstileError(null);
                      setVisibleTurnstileToken(token);
                    }}
                    onError={(message) => {
                      setVisibleTurnstileToken(null);
                      setVisibleTurnstileError(message);
                    }}
                  />
                  <Typography className="text-sm text-gray-600 dark:text-gray-300">
                    Current visible token: {visibleTurnstileToken == null ? "not ready" : "ready"}
                  </Typography>
                  {visibleTurnstileError != null ? (
                    <Typography className="text-sm text-red-600 dark:text-red-400">
                      {visibleTurnstileError}
                    </Typography>
                  ) : null}
                </div>
              ) : null}
            </CardContent>
            <CardFooter className="flex gap-3">
              <Button
                loading={loadingFlow === "invisible-invalid"}
                onClick={async () => await submitInvisibleAttempt({
                  flow: "invisible-invalid",
                  token: demoInvisibleTokens.invalid,
                })}
              >
                Run invisible fail step
              </Button>
              <Button
                variant="secondary"
                loading={loadingFlow === "visible-retry"}
                disabled={visibleFallbackState == null || visibleTurnstileToken == null}
                onClick={async () => await completeVisibleFallbackSignup()}
              >
                Complete raw visible fallback
              </Button>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <Typography type="h3">Forced invisible success</Typography>
            </CardHeader>
            <CardContent className="space-y-3">
              <Typography>
                Sends the local stub token <span className="font-mono">{demoInvisibleTokens.success}</span>.
              </Typography>
              <Typography className="text-sm text-gray-600 dark:text-gray-300">
                Expected backend effect: signup succeeds immediately with no Turnstile penalty.
              </Typography>
            </CardContent>
            <CardFooter>
              <Button
                loading={loadingFlow === "invisible-ok"}
                onClick={async () => await submitInvisibleAttempt({
                  flow: "invisible-ok",
                  token: demoInvisibleTokens.success,
                })}
              >
                Run raw invisible success
              </Button>
            </CardFooter>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <Typography type="h3">Visible captcha also fails</Typography>
            </CardHeader>
            <CardContent className="space-y-3">
              <Typography>
                Sends <span className="font-mono">{demoInvisibleTokens.invalid}</span> with <span className="font-mono">turnstilePhase: &quot;visible&quot;</span> and <span className="font-mono">previousTurnstileResult: &quot;invalid&quot;</span>.
              </Typography>
              <Typography className="text-sm text-gray-600 dark:text-gray-300">
                Simulates the worst case: the invisible attempt failed, then the visible fallback token also fails server-side validation. The backend should reject the signup.
              </Typography>
            </CardContent>
            <CardFooter>
              <Button
                loading={loadingFlow === "visible-fail"}
                onClick={async () => await submitVisibleFailAttempt()}
              >
                Run both-fail flow
              </Button>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <Typography type="h3">No token (backwards compatibility)</Typography>
            </CardHeader>
            <CardContent className="space-y-3">
              <Typography>
                Calls <span className="font-mono">signUpWithCredential</span> without passing any Turnstile token or phase.
              </Typography>
              <Typography className="text-sm text-gray-600 dark:text-gray-300">
                Simulates an older SDK client that does not support Turnstile yet. The backend should still accept the request and apply a default risk penalty for the missing token.
              </Typography>
            </CardContent>
            <CardFooter>
              <Button
                loading={loadingFlow === "no-token"}
                onClick={async () => await submitNoTokenAttempt()}
              >
                Run no-token signup
              </Button>
            </CardFooter>
          </Card>
        </div>

        {submissionResult != null ? (
          <Card>
            <CardHeader>
              <Typography type="h3">Last result</Typography>
            </CardHeader>
            <CardContent>
              <Typography
                className={
                  submissionResult.status === "error"
                    ? "text-red-600 dark:text-red-400"
                    : submissionResult.status === "success"
                      ? "text-green-700 dark:text-green-300"
                      : "text-blue-700 dark:text-blue-300"
                }
              >
                {submissionResult.flow}: {submissionResult.message}
              </Typography>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <Typography type="h3">Hosted auth flow</Typography>
          </CardHeader>
          <CardContent className="space-y-2">
            <Typography>
              Hosted auth pages use the same staged Turnstile behavior automatically. This page separates the recommended custom wrapper flow from the raw debug-only flows so you can compare them directly.
            </Typography>
          </CardContent>
          <CardFooter className="flex gap-3">
            <Link href="/" className="inline-flex items-center rounded-md border px-4 py-2 text-sm font-medium">
              Back to home
            </Link>
            <Link href={app.urls.signUp} className="inline-flex items-center rounded-md border px-4 py-2 text-sm font-medium">
              Open hosted sign-up
            </Link>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
