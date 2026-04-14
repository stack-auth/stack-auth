'use client';

import { KnownError } from "@stackframe/stack-shared";
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
  const [showRedirectLink, setShowRedirectLink] = useState(false);

  useEffect(() => runAsynchronously(async () => {
    if (called.current) return;
    called.current = true;
    try {
      const hasRedirected = await app.callOAuthCallback();
      if (!hasRedirected) {
        await app.redirectToSignIn({ noRedirectBack: true });
      }
    } catch (e) {
      if (KnownError.isKnownError(e)) {
        const errorUrl = new URL(app.urls.error, window.location.href);
        errorUrl.searchParams.set("errorCode", e.errorCode);
        errorUrl.searchParams.set("message", e.message);
        errorUrl.searchParams.set("details", JSON.stringify(e.details ?? {}));
        window.location.replace(errorUrl.toString());
        return;
      }
      captureError("<OAuthCallback />", e);
      window.location.replace(new URL(app.urls.error, window.location.href).toString());
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
      </div>
    </MaybeFullPage>
  );
}
