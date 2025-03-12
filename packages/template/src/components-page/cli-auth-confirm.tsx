'use client';

import { Typography } from "@stackframe/stack-ui";
import { useState } from "react";
import { stackAppInternalsSymbol, useStackApp } from "..";
import { MessageCard } from "../components/message-cards/message-card";
import { useTranslation } from "../lib/translations";

export function CliAuthConfirmation({ fullPage = true }: { fullPage?: boolean }) {
  const { t } = useTranslation();
  const app = useStackApp();
  const [authorizing, setAuthorizing] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const user = app.useUser({ or: "redirect" });

  const handleAuthorize = async () => {
    if (authorizing) return;

    setAuthorizing(true);
    try {
      // Get login code from URL query parameters
      const urlParams = new URLSearchParams(window.location.search);
      const loginCode = urlParams.get("login_code");

      if (!loginCode) {
        throw new Error("Missing login code in URL parameters");
      }
      const refreshToken = (await user.currentSession.getTokens()).refreshToken;
      if (!refreshToken) {
        throw new Error("You must be logged in to authorize CLI access");
      }

      // Use the internal API to send the CLI login request
      const result = await (app as any)[stackAppInternalsSymbol].sendRequest("/auth/cli/complete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          login_code: loginCode,
          refresh_token: (await user.currentSession.getTokens()).refreshToken
        })
      });

      if (!result.ok) {
        throw new Error(`Authorization failed: ${result.status} ${await result.text()}`);
      }

      setSuccess(true);
    } catch (err) {
      setError(err as Error);
    } finally {
      setAuthorizing(false);
    }
  };

  if (success) {
    return (
      <MessageCard
        title={t("CLI Authorization Successful")}
        fullPage={fullPage}
        primaryButtonText={t("Close")}
        primaryAction={() => window.close()}
      >
        <Typography>
          {t("The CLI application has been authorized successfully. You can now close this window and return to the command line.")}
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
        primaryAction={() => setError(null)}
        secondaryButtonText={t("Cancel")}
        secondaryAction={() => window.close()}
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

  return (
    <MessageCard
      title={t("Authorize CLI Application")}
      fullPage={fullPage}
      primaryButtonText={authorizing ? t("Authorizing...") : t("Authorize")}
      primaryAction={handleAuthorize}
      secondaryButtonText={t("Cancel")}
      secondaryAction={() => window.close()}
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
