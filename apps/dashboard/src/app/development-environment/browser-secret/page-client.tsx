"use client";

import { storeRemoteDevelopmentEnvironmentBrowserSecret } from "@/app/remote-development-environment-browser-secret-client";
import { runAsynchronouslyWithAlert } from "@hexclave/shared/dist/utils/promises";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseInitResponse(value: unknown): { expiresAtMillis: number } {
  if (!isRecord(value) || typeof value.expires_at_millis !== "number") {
    throw new Error("Development environment confirmation-code endpoint returned an invalid response.");
  }
  return { expiresAtMillis: value.expires_at_millis };
}

function parseSubmitResponse(value: unknown): { browserSecret: string } {
  if (!isRecord(value) || typeof value.browser_secret !== "string") {
    throw new Error("Development environment confirmation-code submit endpoint returned an invalid response.");
  }
  return { browserSecret: value.browser_secret };
}

async function requestConfirmationCode(): Promise<{ expiresAtMillis: number }> {
  const response = await fetch("/api/development-environment/browser-secret/init-confirmation-code", {
    method: "POST",
    headers: {
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to create development environment confirmation code (${response.status}): ${await response.text()}`);
  }
  return parseInitResponse(await response.json());
}

function sameOriginReturnTo(searchParams: URLSearchParams): string {
  const returnTo = searchParams.get("return_to");
  if (returnTo == null) return "/";
  let parsed: URL;
  try {
    parsed = new URL(returnTo, window.location.href);
  } catch {
    return "/";
  }
  return parsed.origin === window.location.origin ? parsed.toString() : "/";
}

export function BrowserSecretConfirmationPageClient() {
  const [code, setCode] = useState("");
  const [expiresAtMillis, setExpiresAtMillis] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resendingCode, setResendingCode] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [returnTo, setReturnTo] = useState("/");

  useEffect(() => {
    setReturnTo(sameOriginReturnTo(new URLSearchParams(window.location.search)));
    runAsynchronouslyWithAlert((async () => {
      setExpiresAtMillis((await requestConfirmationCode()).expiresAtMillis);
    })());
  }, []);

  const resendCode = async () => {
    setResendingCode(true);
    setErrorMessage(null);
    setResendMessage(null);
    try {
      setCode("");
      setExpiresAtMillis((await requestConfirmationCode()).expiresAtMillis);
      setResendMessage("Code resent. Check the running CLI for the new code.");
    } finally {
      setResendingCode(false);
    }
  };

  const submitCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const response = await fetch("/api/development-environment/browser-secret/submit-confirmation-code", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ code }),
      });
      if (!response.ok) {
        setErrorMessage("That confirmation code did not work. Check the running CLI and try again.");
        return;
      }
      const { browserSecret } = parseSubmitResponse(await response.json());
      await storeRemoteDevelopmentEnvironmentBrowserSecret(browserSecret);
      window.location.assign(returnTo);
    } finally {
      setSubmitting(false);
    }
  };

  const expiresText = expiresAtMillis == null
    ? "Creating a code..."
    : `The code expires in about ${Math.max(0, Math.ceil((expiresAtMillis - Date.now()) / 1000))} seconds.`;

  return (
    <div className="relative z-10 min-h-screen bg-background text-foreground flex items-center justify-center px-4">
      <div className="w-full max-w-lg rounded-2xl border border-black/[0.10] dark:border-white/[0.10] bg-white dark:bg-background p-6 shadow-sm">
        <div className="mb-3 inline-flex rounded-full bg-blue-500/10 px-3 py-1 text-xs font-medium text-blue-700 dark:text-blue-300">
          Browser authorization
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Authorize this browser</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          This dashboard is reachable through a forwarded address. To keep it private, enter the 6-character confirmation code shown by the running <code className="rounded bg-black/[0.04] dark:bg-white/[0.06] px-1 py-0.5 text-xs">hexclave dev</code> command.
        </p>
        <p className="mt-3 text-sm text-muted-foreground">{expiresText}</p>
        <form className="mt-5 space-y-4" onSubmit={(event) => {
          runAsynchronouslyWithAlert(submitCode(event));
        }}>
          <div>
            <label htmlFor="browser-secret-code" className="text-sm font-medium">
              Confirmation code
            </label>
            <input
              id="browser-secret-code"
              autoFocus
              autoComplete="one-time-code"
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))}
              className="mt-2 w-full rounded-lg border bg-background px-3 py-2 text-lg font-mono tracking-[0.35em]"
              placeholder="ABC123"
            />
          </div>
          {errorMessage != null && (
            <p className="text-sm text-destructive">{errorMessage}</p>
          )}
          {resendMessage != null && (
            <p className="text-sm text-muted-foreground">{resendMessage}</p>
          )}
          <button
            type="submit"
            disabled={submitting || code.length !== 6}
            className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Authorizing..." : "Authorize browser"}
          </button>
          <button
            type="button"
            disabled={resendingCode || submitting}
            onClick={() => runAsynchronouslyWithAlert(resendCode())}
            className="w-full rounded-lg border border-black/[0.10] dark:border-white/[0.10] px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
          >
            {resendingCode ? "Resending code..." : "Resend code"}
          </button>
        </form>
      </div>
    </div>
  );
}
