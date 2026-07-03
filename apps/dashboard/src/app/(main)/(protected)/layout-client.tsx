"use client";

import Loading from "@/app/loading";
import { CursorBlastEffect } from "@hexclave/dashboard-ui-components";
import { ConfigUpdateDialogProvider } from "@/components/config-update";
import { HexclaveRebrandModal } from "@/components/hexclave-rebrand-modal";
import { getPublicEnvVar } from '@/lib/env';
import { useStackApp, useUser } from "@hexclave/next";
import { runAsynchronouslyWithAlert } from "@hexclave/shared/dist/utils/promises";
import { generateUuid } from "@hexclave/shared/dist/utils/uuids";
import { useEffect, useRef } from "react";

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

    const autoLogin = async () => {
      if (isPreview) {
        const id = generateUuid();
        const email = `preview-${id}@preview.hexclave.com`;
        const password = `PreviewPass-${id}`;
        const signInResult = await app.signInWithCredential({ email, password, noRedirect: true });
        if (signInResult.status === "error") {
          await app.signUpWithCredential({ email, password, noRedirect: true });
        }
      }
    };
    runAsynchronouslyWithAlert(autoLogin());
  }, [user, app, isRemoteDevelopmentEnvironment, isPreview]);

  if ((isRemoteDevelopmentEnvironment || isPreview) && !user) {
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
