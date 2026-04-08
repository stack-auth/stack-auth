'use client';

import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { Typography } from "@stackframe/stack-ui";
import { useEffect, useRef, useState } from "react";
import { type StackClientApp, stackAppInternalsSymbol, useStackApp } from "..";
import { MessageCard } from "../components/message-cards/message-card";
import { useTranslation } from "../lib/translations";

async function postCliAuthComplete(app: StackClientApp, body: Record<string, unknown>) {
  return await app[stackAppInternalsSymbol].sendRequest("/auth/cli/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function ensureCliCompleteOk(result: Response) {
  if (!result.ok) {
    throw new Error(`Authorization failed: ${result.status} ${await result.text()}`);
  }
}

async function completeCliAuthWithRefreshToken(app: StackClientApp, loginCode: string, refreshToken: string) {
  const result = await postCliAuthComplete(app, { login_code: loginCode, refresh_token: refreshToken });
  await ensureCliCompleteOk(result);
}

function markUrlConfirmed() {
  const url = new URL(window.location.href);
  url.searchParams.set("confirmed", "true");
  window.history.replaceState({}, "", url.toString());
}

export function CliAuthConfirmation({ fullPage = true }: { fullPage?: boolean }) {
  const { t } = useTranslation();
  const app = useStackApp();
  const user = app.useUser({ includeRestricted: true });
  const [authorizing, setAuthorizing] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const autoCompleteRef = useRef(false);

  const [loginCode] = useState(() => {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get("login_code");
  });
  const [confirmed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get("confirmed") === "true";
  });

  useEffect(() => {
    if (!confirmed || !user || autoCompleteRef.current) {
      return;
    }
    autoCompleteRef.current = true;
    runAsynchronouslyWithAlert(async () => {
      setAuthorizing(true);
      try {
        if (!loginCode) {
          throw new Error("Missing login code in URL parameters");
        }
        const refreshToken = (await user.currentSession.getTokens()).refreshToken;
        if (!refreshToken) {
          throw new Error("Could not retrieve session token");
        }
        await completeCliAuthWithRefreshToken(app, loginCode, refreshToken);
        setSuccess(true);
      } catch (err) {
        setError(err as Error);
      } finally {
        setAuthorizing(false);
      }
    });
  }, [confirmed, user, loginCode, app]);

  const handleAuthorize = async () => {
    if (authorizing) {
      return;
    }
    setAuthorizing(true);
    try {
      if (!loginCode) {
        throw new Error("Missing login code in URL parameters");
      }

      if (user) {
        const refreshToken = (await user.currentSession.getTokens()).refreshToken;
        if (!refreshToken) {
          throw new Error("Could not retrieve session token");
        }
        await completeCliAuthWithRefreshToken(app, loginCode, refreshToken);
        setSuccess(true);
        return;
      }

      const checkResult = await postCliAuthComplete(app, { login_code: loginCode, mode: "check" });
      if (!checkResult.ok) {
        throw new Error(`Failed to verify login code: ${checkResult.status} ${await checkResult.text()}`);
      }
      const checkData = await checkResult.json();
      const cliSessionState: string | null = checkData.cli_session_state ?? null;

      if (cliSessionState === "anonymous") {
        const claimResult = await postCliAuthComplete(app, { login_code: loginCode, mode: "claim-anon-session" });

        if (!claimResult.ok) {
          throw new Error(`Failed to claim anonymous session: ${claimResult.status} ${await claimResult.text()}`);
        }

        const tokens = await claimResult.json();
        await app[stackAppInternalsSymbol].signInWithTokens({
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
        });
        // Only mark the URL as confirmed once the anon session is actually
        // bound to the browser; otherwise a failure above would leave a stale
        // confirmed=true in the URL and the auto-complete effect would later
        // bind the CLI to whichever user happens to be signed in.
        markUrlConfirmed();
        await app.redirectToSignUp({ replace: true });
        return;
      }

      markUrlConfirmed();
      await app.redirectToSignIn({ replace: true });
    } catch (err) {
      setError(err as Error);
    } finally {
      setAuthorizing(false);
    }
  };

  if (success) {
    return (
      <MessageCard title={t("CLI Authorization Successful")} fullPage={fullPage}>
        <Typography>
          {t("The CLI application has been authorized successfully. You can close this window and return to the command line.")}
        </Typography>
      </MessageCard>
    );
  }

  if (error) {
    return (
      <MessageCard
        title={t("Authorization Failed")}
        fullPage={fullPage}
        primaryButtonText={t("Try Again")}
        primaryAction={() => {
          setError(null);
          autoCompleteRef.current = false;
        }}
      >
        <Typography className="text-red-600">
          {t("Failed to authorize the CLI application:")}
        </Typography>
        <Typography className="text-red-600">
          {error.message}
        </Typography>
      </MessageCard>
    );
  }

  if (confirmed && authorizing) {
    return (
      <MessageCard title={t("Completing Authorization...")} fullPage={fullPage}>
        <Typography>
          {t("Finishing up the CLI authorization...")}
        </Typography>
      </MessageCard>
    );
  }

  return (
    <MessageCard
      title={t("Authorize CLI Application")}
      fullPage={fullPage}
      primaryButtonText={authorizing ? t("Authorizing...") : t("Authorize")}
      primaryAction={handleAuthorize}
    >
      <Typography>
        {t("A command line application is requesting access to your account. Click the button below to authorize it.")}
      </Typography>
      <Typography variant="destructive">
        {t("WARNING: Make sure you trust the command line application, as it will gain access to your account. If you did not initiate this request, you can close this page and ignore it. We will never send you this link via email or any other means.")}
      </Typography>
    </MessageCard>
  );
}
