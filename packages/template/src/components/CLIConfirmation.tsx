import { KnownErrors } from "@stackframe/stack-shared";
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

      // Make the API call
      const response = await fetch("/api/latest/auth/cli/complete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Add auth headers if needed
          ...await user.getAuthHeaders(),
        },
        body: JSON.stringify({
          login_code: loginCode,
          refresh_token: tokens.refreshToken,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to complete CLI authentication: ${response.status}`);
      }

      setStatus("success");
      onSuccess?.();
    } catch (error) {
      // Handle specific known errors
      if (error instanceof KnownErrors.SchemaError) {
        setErrorMessage("Invalid login code or the code has expired");
      } else if (error instanceof Error) {
        setErrorMessage(error.message);
      } else {
        setErrorMessage("An unknown error occurred");
      }

      setStatus("error");
      if (error instanceof Error) {
        onError?.(error);
      } else {
        onError?.(new Error("An unknown error occurred"));
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
