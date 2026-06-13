"use client";

import { KnownError } from "@hexclave/shared";
import { Typography } from "@hexclave/ui";
import { useStackApp } from "../..";
import { MessageCard } from "./message-card";

export function KnownErrorMessageCard({
  error,
  fullPage=false,
}: {
  error: KnownError,
  fullPage?: boolean,
}) {
  const hexclaveApp = useStackApp();

  return (
    <MessageCard
      title={"An error occurred"}
      fullPage={fullPage}
      primaryButtonText={"Go Home"}
      primaryAction={() => hexclaveApp.redirectToHome()}
    >
      {<Typography>Error Code: {error.errorCode}</Typography>}
      {<Typography>Error Message: {error.message}</Typography>}
    </MessageCard>
  );
}
