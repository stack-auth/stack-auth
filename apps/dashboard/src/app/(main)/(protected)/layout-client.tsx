"use client";

import Loading from "@/app/loading";
import { CursorBlastEffect } from "@hexclave/dashboard-ui-components";
import { ConfigUpdateDialogProvider } from "@/components/config-update";
import { DesignAlert } from "@/components/design-components/alert";
import { HexclaveRebrandModal } from "@/components/hexclave-rebrand-modal";
import { getPublicEnvVar } from '@/lib/env';
import { useStackApp, useUser } from "@hexclave/next";
import { captureError } from "@hexclave/shared/dist/utils/errors";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { generateUuid } from "@hexclave/shared/dist/utils/uuids";
import { useEffect, useRef, useState } from "react";

export default function LayoutClient({ children }: { children: React.ReactNode }) {
  const app = useStackApp();
  const isRemoteDevelopmentEnvironment = getPublicEnvVar("NEXT_PUBLIC_STACK_IS_REMOTE_DEVELOPMENT_ENVIRONMENT") === "true";
  const isPreview = getPublicEnvVar("NEXT_PUBLIC_STACK_IS_PREVIEW") === "true";
  const user = useUser(
    isRemoteDevelopmentEnvironment
      ? {
        or: "anonymous-if-exists[deprecated]",
      }
      : undefined
  );
  const autoLoginStarted = useRef(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    // Run the auto-login at most once. Without this guard, React StrictMode
    // (and any other re-invocation before the async sign-in resolves) runs the
    // effect again while `user` is still null — and in preview mode each run
    // generates a fresh `preview-*` email, creating a *second* preview user.
    // The session then settles on one user while a project may have been
    // created for the other, which surfaces as a 404 on the project page.
    if (user || autoLoginStarted.current) return;
    if (isRemoteDevelopmentEnvironment) return;
    autoLoginStarted.current = true;

    if (isPreview) {
      const autoLogin = async () => {
        const id = generateUuid();
        const email = `preview-${id}@preview.hexclave.com`;
        const password = `PreviewPass-${id}`;
        const signInResult = await app.signInWithCredential({ email, password, noRedirect: true });
        if (signInResult.status === "error") {
          const signUpResult = await app.signUpWithCredential({ email, password, noRedirect: true });
          if (signUpResult.status === "error") {
            throw signUpResult.error;
          }
        }
      };
      runAsynchronously(autoLogin(), {
        // We report the error ourselves under a dedicated tag, so we opt out of
        // runAsynchronously's generic logging to avoid duplicate Sentry events.
        noErrorLogging: true,
        onError: (error) => {
          captureError("preview-auto-login", error);
          setError(true);
        },
      });
    }
  }, [user, app, isRemoteDevelopmentEnvironment, isPreview]);

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <DesignAlert
          variant="error"
          title="Preview unavailable"
          description="The preview could not be opened. Reload the page to try again."
          className="max-w-lg"
        />
      </main>
    );
  } else if ((isRemoteDevelopmentEnvironment || isPreview) && !user) {
    return <Loading />;
  } else {
    return (
      <ConfigUpdateDialogProvider>
        <CursorBlastEffect />
        <HexclaveRebrandModal />
        {children}
      </ConfigUpdateDialogProvider>
    );
  }
}
