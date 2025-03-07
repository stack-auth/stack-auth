'use client';

import { Typography } from "@stackframe/stack-ui";
import { useState } from "react";
import { useStackApp } from "..";
import { MessageCard } from "../components/message-cards/message-card";
import { useTranslation } from "../lib/translations";

export function CLIConfirmation({ fullPage = true }: { fullPage?: boolean }) {
  const { t } = useTranslation();
  const app = useStackApp();
  const [authorizing, setAuthorizing] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const user = app.useUser();

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

      // We can get a session from the user, which is currently logged in
      if (!user) {
        throw new Error("You must be signed in to authorize CLI applications");
      }

      // Get the refresh token from session storage
      const refreshTokenStr = localStorage.getItem(`stack.tokens.${app.projectId}.refresh_token`);
      if (!refreshTokenStr) {
        throw new Error("No refresh token found. Please sign in again.");
      }

      try {
        // Make the fetch request directly
        const response = await fetch(`${window.location.origin}/api/v1/auth/cli/login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Stack-Project-Id': app.projectId,
          },
          body: JSON.stringify({
            login_code: loginCode,
            refresh_token: refreshTokenStr,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.message || 'Failed to authorize CLI');
        }
      } catch (fetchError) {
        throw new Error(`Authentication failed: ${(fetchError as Error).message}`);
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
    </MessageCard>
  );
}
