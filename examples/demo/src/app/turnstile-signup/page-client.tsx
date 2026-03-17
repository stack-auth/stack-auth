'use client';

import { KnownErrors } from "@stackframe/stack-shared";
import { stackAppInternalsSymbol, useStackApp, useUser } from "@stackframe/stack";
import { turnstileDevelopmentKeys } from "@stackframe/stack-shared/dist/utils/turnstile";
import { executeTurnstileInvisible, showTurnstileVisibleChallenge, BotChallengeUserCancelledError, withBotChallengeFlow } from "@stackframe/stack-shared/dist/utils/turnstile-flow";
import { Button, Card, CardContent, CardFooter, CardHeader, Input, Label, PasswordInput, Typography } from "@stackframe/stack-ui";
import Link from "next/link";
import { useState } from "react";

function createSuggestedEmail() {
  const suffix = crypto.randomUUID().slice(0, 8);
  return `turnstile-demo+${suffix}@example.com`;
}

const testKeys = {
  invisiblePass: turnstileDevelopmentKeys.invisibleSiteKey,
  visiblePass: turnstileDevelopmentKeys.visibleSiteKey,
  forceChallenge: turnstileDevelopmentKeys.forcedChallengeSiteKey,
};

type FlowResult = {
  status: "success" | "error" | "info",
  message: string,
};

type SignupResult =
  | { ok: true, accessToken: string, refreshToken: string }
  | { ok: false, code: string, message: string };

/**
 * Sends a signup request through the SDK's internal request pipeline.
 * Catches KnownErrors (which sendClientRequest throws) and returns structured results.
 */
async function debugSignup(
  sendRequest: (path: string, init: RequestInit) => Promise<Response>,
  options: {
    email: string,
    password: string,
    turnstileToken?: string,
    turnstilePhase?: "invisible" | "visible",
  },
): Promise<SignupResult> {
  const bodyObj: Record<string, unknown> = {
    email: options.email,
    password: options.password,
  };
  if (options.turnstileToken) {
    bodyObj.bot_challenge_token = options.turnstileToken;
  }
  if (options.turnstilePhase) {
    bodyObj.bot_challenge_phase = options.turnstilePhase;
  }

  try {
    const res = await sendRequest("/auth/password/sign-up", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyObj),
    });
    if (res.ok) {
      const resBody = await res.json().catch(() => ({}));
      return { ok: true, accessToken: resBody.access_token, refreshToken: resBody.refresh_token };
    }
    const resBody = await res.json().catch(() => ({}));
    return { ok: false, code: resBody.code ?? `HTTP_${res.status}`, message: resBody.message ?? res.statusText };
  } catch (e: unknown) {
    // sendClientRequest throws KnownErrors instead of returning error responses
    if (e instanceof KnownErrors.BotChallengeRequired) {
      return { ok: false, code: "BOT_CHALLENGE_REQUIRED", message: e.message };
    }
    if (e instanceof KnownErrors.UserWithEmailAlreadyExists) {
      return { ok: false, code: "USER_EMAIL_ALREADY_EXISTS", message: e.message };
    }
    if (e instanceof KnownErrors.PasswordRequirementsNotMet) {
      return { ok: false, code: "PASSWORD_REQUIREMENTS_NOT_MET", message: e.message };
    }
    // Re-throw unknown errors
    throw e;
  }
}

function isChallengeRequired(result: SignupResult): boolean {
  return !result.ok && result.code === "BOT_CHALLENGE_REQUIRED";
}

export default function TurnstileSignupPageClient() {
  const app = useStackApp();
  const user = useUser({ includeRestricted: true });
  const [email, setEmail] = useState(() => createSuggestedEmail());
  const [password, setPassword] = useState("Demo-password-123!");

  // SDK signup state
  const [sdkResult, setSdkResult] = useState<FlowResult | null>(null);

  // Debug card state
  const [loadingFlow, setLoadingFlow] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<FlowResult | null>(null);

  const internals = app[stackAppInternalsSymbol] as any;
  const sendRequest: (path: string, init: RequestInit) => Promise<Response> = internals.sendRequest;
  const signInWithTokens: (tokens: { accessToken: string, refreshToken: string }) => Promise<void> = internals.signInWithTokens;

  function freshEmail() {
    const e = createSuggestedEmail();
    setEmail(e);
    return e;
  }

  if (user != null) {
    return (
      <div className="container mx-auto p-6 max-w-4xl">
        <Card>
          <CardHeader>
            <Typography type="h2">Turnstile Signup Demo</Typography>
          </CardHeader>
          <CardContent className="space-y-3">
            <Typography>
              Signed in as <span className="font-mono">{user.primaryEmail ?? user.id}</span>.
            </Typography>
            <Typography className="text-sm text-gray-600 dark:text-gray-300">
              Sign out to rerun the flows from a clean state.
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

  // ── SDK signup ──
  async function handleSdkSignUp() {
    setSdkResult(null);
    try {
      const result = await app.signUpWithCredential({
        email,
        password,
        noRedirect: true,
        noVerificationCallback: true,
      });
      if (result.status === "error") {
        setSdkResult({ status: "error", message: result.error.message });
      } else {
        setSdkResult({ status: "success", message: "Signup succeeded. Turnstile was handled transparently by the SDK." });
      }
    } catch (e) {
      if (e instanceof BotChallengeUserCancelledError) {
        setSdkResult({ status: "error", message: "Turnstile challenge cancelled by user." });
      } else {
        setSdkResult({ status: "error", message: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  // ── Debug flow runner ──
  async function runFlow(
    id: string,
    fn: (signupEmail: string) => Promise<FlowResult>,
  ) {
    setLoadingFlow(id);
    setLastResult(null);
    const signupEmail = freshEmail();
    try {
      const result = await fn(signupEmail);
      setLastResult(result);
    } catch (e) {
      if (e instanceof BotChallengeUserCancelledError) {
        setLastResult({ status: "error", message: "User cancelled the visible challenge — signup blocked." });
      } else {
        setLastResult({ status: "error", message: e instanceof Error ? e.message : String(e) });
      }
    } finally {
      setLoadingFlow(null);
    }
  }

  // Flow: invisible token succeeds → signup
  async function flowInvisibleOk(signupEmail: string): Promise<FlowResult> {
    const token = await executeTurnstileInvisible(testKeys.invisiblePass, "sign_up_with_credential");
    const res = await debugSignup(sendRequest, {
      email: signupEmail, password,
      turnstileToken: token,
      turnstilePhase: "invisible",
    });
    if (res.ok) {
      await signInWithTokens({ accessToken: res.accessToken, refreshToken: res.refreshToken });
      return { status: "success", message: "Signup succeeded. Invisible token was accepted." };
    }
    return { status: "error", message: `Signup failed: ${res.code} — ${res.message}` };
  }

  // Flow: invisible fails → visible challenge → signup
  async function flowChallengeRequired(signupEmail: string): Promise<FlowResult> {
    const firstRes = await debugSignup(sendRequest, {
      email: signupEmail, password,
      turnstileToken: "mock-turnstile-invalid",
      turnstilePhase: "invisible",
    });

    if (firstRes.ok) {
      return { status: "success", message: "Signup unexpectedly succeeded on first attempt (no challenge required)." };
    }

    if (!isChallengeRequired(firstRes)) {
      return { status: "error", message: `Expected BOT_CHALLENGE_REQUIRED, got: ${firstRes.code}` };
    }

    const visibleToken = await showTurnstileVisibleChallenge(testKeys.forceChallenge, "sign_up_with_credential");

    const secondRes = await debugSignup(sendRequest, {
      email: signupEmail, password,
      turnstileToken: visibleToken,
      turnstilePhase: "visible",
    });

    if (secondRes.ok) {
      await signInWithTokens({ accessToken: secondRes.accessToken, refreshToken: secondRes.refreshToken });
      return { status: "success", message: "Signup succeeded after visible challenge." };
    }
    return { status: "error", message: `Retry failed: ${secondRes.code} — ${secondRes.message}` };
  }

  // Flow: both invisible and visible fail → blocked
  async function flowBothFail(signupEmail: string): Promise<FlowResult> {
    const firstRes = await debugSignup(sendRequest, {
      email: signupEmail, password,
      turnstileToken: "mock-turnstile-invalid",
      turnstilePhase: "invisible",
    });

    if (!isChallengeRequired(firstRes)) {
      return { status: "error", message: `Expected BOT_CHALLENGE_REQUIRED, got: ${firstRes.ok ? "ok" : firstRes.code}` };
    }

    const secondRes = await debugSignup(sendRequest, {
      email: signupEmail, password,
      turnstileToken: "mock-turnstile-invalid",
      turnstilePhase: "visible",
    });

    if (secondRes.ok) {
      return { status: "error", message: "Signup unexpectedly succeeded even with invalid visible token." };
    }
    return { status: "success", message: `Signup correctly blocked: ${secondRes.code}` };
  }

  // Flow: no token at all
  async function flowNoToken(signupEmail: string): Promise<FlowResult> {
    const res = await debugSignup(sendRequest, { email: signupEmail, password });
    if (res.ok) {
      await signInWithTokens({ accessToken: res.accessToken, refreshToken: res.refreshToken });
      return { status: "success", message: "Signup succeeded without any token. Backend accepted it." };
    }
    return { status: "error", message: `Signup failed: ${res.code} — ${res.message}` };
  }

  // Flow: withBotChallengeFlow orchestrator
  async function flowOrchestrator(signupEmail: string): Promise<FlowResult> {
    const result = await withBotChallengeFlow({
      invisibleSiteKey: testKeys.invisiblePass,
      visibleSiteKey: testKeys.forceChallenge,
      action: "sign_up_with_credential",
      execute: async (turnstile) => {
        return await debugSignup(sendRequest, {
          email: signupEmail, password,
          turnstileToken: turnstile.token,
          turnstilePhase: turnstile.phase,
        });
      },
      isChallengeRequired: (res) => {
        return !res.ok && res.code === "BOT_CHALLENGE_REQUIRED";
      },
    });

    if (result.ok) {
      await signInWithTokens({ accessToken: result.accessToken, refreshToken: result.refreshToken });
      return { status: "success", message: "Signup succeeded via withBotChallengeFlow orchestrator." };
    }
    return { status: "error", message: `Signup failed: ${result.code} — ${result.message}` };
  }

  // Flow: random outcome (simulates realistic behavior)
  async function flowRandom(signupEmail: string): Promise<FlowResult> {
    const rand = Math.random();
    if (rand < 0.4) {
      // 40%: invisible succeeds
      const token = await executeTurnstileInvisible(testKeys.invisiblePass, "sign_up_with_credential");
      const res = await debugSignup(sendRequest, {
        email: signupEmail, password,
        turnstileToken: token,
        turnstilePhase: "invisible",
      });
      if (res.ok) {
        await signInWithTokens({ accessToken: res.accessToken, refreshToken: res.refreshToken });
        return { status: "success", message: "[Random: invisible pass] Signup succeeded." };
      }
      return { status: "error", message: `[Random: invisible pass] Failed: ${res.code}` };
    } else if (rand < 0.7) {
      // 30%: invisible fails → visible challenge → succeeds
      const firstRes = await debugSignup(sendRequest, {
        email: signupEmail, password,
        turnstileToken: "mock-turnstile-invalid",
        turnstilePhase: "invisible",
      });
      if (!isChallengeRequired(firstRes)) {
        return { status: "info", message: `[Random: challenge] Unexpected: ${firstRes.ok ? "ok" : firstRes.code}` };
      }
      const visibleToken = await showTurnstileVisibleChallenge(testKeys.forceChallenge, "sign_up_with_credential");
      const secondRes = await debugSignup(sendRequest, {
        email: signupEmail, password,
        turnstileToken: visibleToken,
        turnstilePhase: "visible",
      });
      if (secondRes.ok) {
        await signInWithTokens({ accessToken: secondRes.accessToken, refreshToken: secondRes.refreshToken });
        return { status: "success", message: "[Random: challenge -> pass] Signup succeeded after challenge." };
      }
      return { status: "error", message: `[Random: challenge -> pass] Retry failed: ${secondRes.code}` };
    } else if (rand < 0.9) {
      // 20%: both fail → blocked
      const firstRes = await debugSignup(sendRequest, {
        email: signupEmail, password,
        turnstileToken: "mock-turnstile-invalid",
        turnstilePhase: "invisible",
      });
      if (!isChallengeRequired(firstRes)) {
        return { status: "info", message: `[Random: both fail] Unexpected: ${firstRes.ok ? "ok" : firstRes.code}` };
      }
      const secondRes = await debugSignup(sendRequest, {
        email: signupEmail, password,
        turnstileToken: "mock-turnstile-invalid",
        turnstilePhase: "visible",
      });
      if (secondRes.ok) {
        return { status: "error", message: "[Random: both fail] Signup unexpectedly succeeded." };
      }
      return { status: "success", message: `[Random: both fail] Signup correctly blocked: ${secondRes.code}` };
    } else {
      // 10%: no token
      const res = await debugSignup(sendRequest, { email: signupEmail, password });
      if (res.ok) {
        await signInWithTokens({ accessToken: res.accessToken, refreshToken: res.refreshToken });
        return { status: "success", message: "[Random: no token] Signup succeeded." };
      }
      return { status: "error", message: `[Random: no token] Failed: ${res.code}` };
    }
  }

  return (
    <div className="container mx-auto p-6 max-w-5xl space-y-8">
      {/* Header */}
      <div className="space-y-2">
        <Typography type="h1">Turnstile Signup Demo</Typography>
        <Typography className="text-gray-600 dark:text-gray-300">
          Test the SDK&apos;s transparent Turnstile integration and exercise individual flows.
        </Typography>
      </div>

      {/* Shared credentials */}
      <Card>
        <CardHeader>
          <Typography type="h3">Shared credentials</Typography>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="demo-email">Email</Label>
              <Input
                id="demo-email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="demo-password">Password</Label>
              <PasswordInput
                id="demo-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                }}
              />
            </div>
          </div>
        </CardContent>
        <CardFooter>
          <Button variant="secondary" size="sm" onClick={() => { freshEmail(); }}>
            Generate new email
          </Button>
        </CardFooter>
      </Card>

      {/* SDK signup (recommended) */}
      <Card>
        <CardHeader>
          <Typography type="h3">SDK signup (recommended)</Typography>
          <Typography className="text-sm text-gray-500">
            Calls <span className="font-mono">app.signUpWithCredential()</span> — Turnstile is handled entirely by the SDK.
          </Typography>
        </CardHeader>
        <CardContent>
          {sdkResult && (
            <Typography className={
              sdkResult.status === "error" ? "text-red-600 dark:text-red-400"
                : sdkResult.status === "success" ? "text-green-700 dark:text-green-300"
                  : "text-blue-600 dark:text-blue-300"
            }>
              {sdkResult.message}
            </Typography>
          )}
        </CardContent>
        <CardFooter>
          <Button onClick={handleSdkSignUp}>Sign up with SDK</Button>
        </CardFooter>
      </Card>

      {/* Debug flows */}
      <div className="space-y-4">
        <Typography type="h2">Debug flows</Typography>
        <Typography className="text-sm text-gray-600 dark:text-gray-300">
          Each card sends controlled Turnstile params to the backend via the SDK&apos;s internal request pipeline. A fresh email is generated per attempt.
        </Typography>

        <div className="grid gap-4 md:grid-cols-2">
          {/* Invisible pass */}
          <Card>
            <CardHeader>
              <Typography type="h4">Invisible token succeeds</Typography>
            </CardHeader>
            <CardContent>
              <Typography className="text-sm text-gray-500">
                Acquires a valid invisible token (always-pass test key) and signs up.
              </Typography>
            </CardContent>
            <CardFooter>
              <Button
                size="sm"
                loading={loadingFlow === "invisible-ok"}
                onClick={() => runFlow("invisible-ok", flowInvisibleOk)}
              >
                Run
              </Button>
            </CardFooter>
          </Card>

          {/* Challenge required → visible → signup */}
          <Card>
            <CardHeader>
              <Typography type="h4">Invisible fails → visible challenge</Typography>
            </CardHeader>
            <CardContent>
              <Typography className="text-sm text-gray-500">
                Sends an invalid invisible token, then shows the visible challenge overlay. Solve it to complete signup.
              </Typography>
            </CardContent>
            <CardFooter>
              <Button
                size="sm"
                loading={loadingFlow === "challenge"}
                onClick={() => runFlow("challenge", flowChallengeRequired)}
              >
                Run
              </Button>
            </CardFooter>
          </Card>

          {/* Both fail → blocked */}
          <Card>
            <CardHeader>
              <Typography type="h4">Both fail → signup blocked</Typography>
            </CardHeader>
            <CardContent>
              <Typography className="text-sm text-gray-500">
                Invalid invisible token, then invalid visible token. Signup should be rejected.
              </Typography>
            </CardContent>
            <CardFooter>
              <Button
                size="sm"
                variant="destructive"
                loading={loadingFlow === "both-fail"}
                onClick={() => runFlow("both-fail", flowBothFail)}
              >
                Run
              </Button>
            </CardFooter>
          </Card>

          {/* No token */}
          <Card>
            <CardHeader>
              <Typography type="h4">No token (backwards compat)</Typography>
            </CardHeader>
            <CardContent>
              <Typography className="text-sm text-gray-500">
                Sends signup with no Turnstile token at all. Tests backwards compatibility.
              </Typography>
            </CardContent>
            <CardFooter>
              <Button
                size="sm"
                variant="secondary"
                loading={loadingFlow === "no-token"}
                onClick={() => runFlow("no-token", flowNoToken)}
              >
                Run
              </Button>
            </CardFooter>
          </Card>

          {/* withBotChallengeFlow orchestrator */}
          <Card>
            <CardHeader>
              <Typography type="h4">withBotChallengeFlow orchestrator</Typography>
            </CardHeader>
            <CardContent>
              <Typography className="text-sm text-gray-500">
                Uses <span className="font-mono">withBotChallengeFlow()</span> to automatically handle invisible → visible fallback.
              </Typography>
            </CardContent>
            <CardFooter>
              <Button
                size="sm"
                variant="secondary"
                loading={loadingFlow === "orchestrator"}
                onClick={() => runFlow("orchestrator", flowOrchestrator)}
              >
                Run
              </Button>
            </CardFooter>
          </Card>

          {/* Random */}
          <Card>
            <CardHeader>
              <Typography type="h4">Random scenario</Typography>
            </CardHeader>
            <CardContent>
              <Typography className="text-sm text-gray-500">
                Randomly picks a scenario (40% invisible pass, 30% challenge, 20% both fail, 10% no token) for realistic testing.
              </Typography>
            </CardContent>
            <CardFooter>
              <Button
                size="sm"
                variant="secondary"
                loading={loadingFlow === "random"}
                onClick={() => runFlow("random", flowRandom)}
              >
                Run
              </Button>
            </CardFooter>
          </Card>
        </div>
      </div>

      {/* Last result */}
      {lastResult && (
        <Card>
          <CardHeader>
            <Typography type="h4">Last result</Typography>
          </CardHeader>
          <CardContent>
            <Typography className={
              lastResult.status === "error" ? "text-red-600 dark:text-red-400"
                : lastResult.status === "success" ? "text-green-700 dark:text-green-300"
                  : "text-blue-600 dark:text-blue-300"
            }>
              {lastResult.message}
            </Typography>
          </CardContent>
        </Card>
      )}

      {/* Config info */}
      <Card>
        <CardHeader>
          <Typography type="h4">Config</Typography>
        </CardHeader>
        <CardContent className="space-y-1 text-sm font-mono">
          <Typography>Project: {app.projectId}</Typography>
          <Typography>Invisible key: {testKeys.invisiblePass}</Typography>
          <Typography>Visible key: {testKeys.visiblePass}</Typography>
          <Typography>Force challenge key: {testKeys.forceChallenge}</Typography>
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
  );
}
