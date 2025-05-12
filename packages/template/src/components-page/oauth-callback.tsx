'use client';

import { captureError } from "@stackframe/stack-shared/dist/utils/errors";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { Spinner, cn } from "@stackframe/stack-ui";
import { useEffect, useRef, useState } from "react";
import { useStackApp } from "..";
import { MaybeFullPage } from "../components/elements/maybe-full-page";
import { StyledLink } from "../components/link";
import { useTranslation } from "../lib/translations";

export function OAuthCallback({ fullPage }: { fullPage?: boolean }) {
  const { t } = useTranslation();
  const app = useStackApp();
  const called = useRef(false);
  const [error, setError] = useState<unknown>(null);
  const [showRedirectLink, setShowRedirectLink] = useState(false);

  useEffect(() => runAsynchronously(async () => {
    if (called.current) return;
    called.current = true;
    let hasRedirected = false;
    try {
      hasRedirected = await app.callOAuthCallback();
    } catch (e) {
      captureError("<OAuthCallback />", e);
      setError(e);
    }
    if (!hasRedirected && (!error || process.env.NODE_ENV === 'production')) {
      await app.redirectToSignIn({ noRedirectBack: true });
    }
  }), []);

  useEffect(() => {
    setTimeout(() => setShowRedirectLink(true), 3000);
  }, []);

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
        {showRedirectLink ? <p>{t('If you are not redirected automatically, ')}<StyledLink className="whitespace-nowrap" href={app.urls.home}>{t("click here")}</StyledLink></p> : null}
        {error ? <div>
          <p>{t("Something went wrong while processing the OAuth callback:")}</p>
          <pre>{JSON.stringify(error, null, 2)}</pre>
          <p>{t("This is most likely an error in Stack. Please report it.")}</p>
        </div> : null}
      </div>
    </MaybeFullPage>
  );
}
