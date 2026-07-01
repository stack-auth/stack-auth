'use client';

import { KnownError } from "@hexclave/shared";
import { captureError } from "@hexclave/shared/dist/utils/errors";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { Spinner, cn } from "@hexclave/ui";
import { useEffect, useRef, useState } from "react";
import { useStackApp } from "..";
import { MaybeFullPage } from "../components/elements/maybe-full-page";
import { StyledLink } from "../components/link";
import { hexclaveAppInternalsSymbol } from "../lib/hexclave-app/common";
import { useTranslation } from "../lib/translations";
import { ErrorPage } from "./error-page";

export function OAuthCallback({ fullPage }: { fullPage?: boolean }) {
  const { t } = useTranslation();
  const app = useStackApp();
  const called = useRef(false);
  const [showRedirectLink, setShowRedirectLink] = useState(false);
  const [errorSearchParams, setErrorSearchParams] = useState<Record<string, string> | null>(null);

  useEffect(() => runAsynchronously(async () => {
    if (called.current) return;
    called.current = true;
    try {
      // The startup handler in StackClientApp's constructor may have already consumed the
      // one-time OAuth params (code + state cookie) via a microtask that fires before this
      // macrotask-scheduled useEffect. Await its completion so we don't race: if it succeeds
      // it will redirect and this page tears down; if it fails we fall through below.
      await app[hexclaveAppInternalsSymbol].awaitPendingAuthResolutions();
      const hasRedirected = await app.callOAuthCallback();
      if (!hasRedirected) {
        await app.redirectToSignIn({ noRedirectBack: true });
      }
    } catch (e) {
      if (KnownError.isKnownError(e)) {
        setErrorSearchParams({
          errorCode: e.errorCode,
          message: e.message,
          details: JSON.stringify(e.details ?? {}),
        });
        return;
      }
      captureError("<OAuthCallback />", e);
      setErrorSearchParams({});
    }
  }), [app]);

  useEffect(() => {
    setTimeout(() => setShowRedirectLink(true), 3000);
  }, []);

  if (errorSearchParams != null) {
    return <ErrorPage searchParams={errorSearchParams} fullPage={fullPage} />;
  }

  return (
    <MaybeFullPage
      fullPage={fullPage ?? false}
      containerClassName="flex items-center justify-center"
    >
      <div
        className={cn(
          "text-center justify-center items-center stack-scope flex flex-col gap-4 max-w-[380px]",
          fullPage ? "p-4" : "p-0"
        )}
      >
        <div className="flex flex-col justify-center items-center gap-4">
          <Spinner size={20} />
        </div>
        {showRedirectLink ? <p>{t('If you are not redirected automatically, ')}<StyledLink
          className="whitespace-nowrap"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            runAsynchronously(app.redirectToHome());
          }}
        >{t("click here")}</StyledLink></p> : null}
      </div>
    </MaybeFullPage>
  );
}
