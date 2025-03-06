'use client';

import { Typography } from "@stackframe/stack-ui";
import { useState } from "react";
import { useStackApp, useUser } from "..";
import { MessageCard } from "../components/message-cards/message-card";
import { useTranslation } from "../lib/translations";

export function CLIConfirmation({ fullPage = true }: { fullPage?: boolean }) {
  const { t } = useTranslation();
  const app = useStackApp();
  const [authorizing, setAuthorizing] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const user = useUser();

  const handleAuthorize = async () => {
    if (authorizing) return;

    setAuthorizing(true);
    try {
      // This is a placeholder for the actual API call to authorize the CLI application
      // Replace with the actual implementation from stack app
      // await app.cliAuth.authorize();
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
