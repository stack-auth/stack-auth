"use client";

import * as Sentry from "@sentry/nextjs";
import { recordGlobalErrorRecoveryAttempt } from "./global-error-recovery";
import { useEffect } from "react";

type GlobalErrorProps = {
  error: Error & { digest?: string };
};

export default function GlobalError({ error }: GlobalErrorProps) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  useEffect(() => {
    if (!recordGlobalErrorRecoveryAttempt()) {
      return;
    }
    let cancelled = false;
    setTimeout(() => {
      if (!cancelled) {
        window.location.assign("/");
      }
    }, 3_000);
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <html>
      <body className="flex items-center justify-center min-h-screen">
        <div className="flex max-w-md flex-col items-center gap-4 p-6 text-center">
          <h1 className="text-xl font-semibold">Something went wrong</h1>
          <p className="text-muted-foreground">The dashboard could not load this page. Try again, or reload the page manually later.</p>
          <button
            type="button"
            className="rounded-md bg-primary px-4 py-2 text-primary-foreground"
            onClick={() => window.location.assign("/")}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
