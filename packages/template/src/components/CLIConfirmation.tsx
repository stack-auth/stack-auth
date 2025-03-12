import { useCallback, useEffect, useState } from "react";
import { useStackApp, useUser } from "..";

export type CLIConfirmationProps = {
  loginCode: string,
  onSuccess?: () => void,
  onError?: (error: Error) => void,
};

export function CLIConfirmation({ loginCode, onSuccess, onError }: CLIConfirmationProps) {
  const app = useStackApp();
  const user = useUser();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const completeCliAuth = useCallback(async () => {
    try {
      if (!user) {
        throw new Error("User must be logged in to complete CLI authentication");
      }

      // Get the refresh token from the current user's session
      const tokens = await user.currentSession.getTokens();
      if (!tokens.refreshToken) {
        throw new Error("No refresh token available");
      }

      // Use fetch with credentials to make the API call
      const response = await fetch(`${app.urls.handler}/auth/cli/complete`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          login_code: loginCode,
          refresh_token: tokens.refreshToken,
        }),
        credentials: "include", // Include cookies for authentication
      });

      if (!response.ok) {
        throw new Error(`Failed to complete CLI authentication: ${response.status}`);
      }

      setStatus("success");
      onSuccess?.();
    } catch (error) {
      // Handle errors with more specific information
      let message = "An unknown error occurred";
      if (error instanceof Error) {
        message = error.message;
      }

      setErrorMessage(message);
      setStatus("error");

      if (error instanceof Error) {
        onError?.(error);
      } else {
        onError?.(new Error(message));
      }
    }
  }, [app, user, loginCode, onSuccess, onError]);

  useEffect(() => {
    // Using an IIFE with a proper catch handler to satisfy the linter
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    (async () => {
      try {
        await completeCliAuth();
      } catch (error) {
        console.error("Error in CLI authentication:", error);
      }
    })();
  }, [completeCliAuth]);

  if (status === "loading") {
    return <div>Completing CLI authentication...</div>;
  } else if (status === "success") {
    return <div>CLI authentication completed successfully! You can now close this window.</div>;
  } else {
    return (
      <div>
        <p>Failed to complete CLI authentication:</p>
        <p>{errorMessage}</p>
      </div>
    );
  }
}
