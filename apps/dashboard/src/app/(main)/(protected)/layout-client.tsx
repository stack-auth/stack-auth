"use client";

import Loading from "@/app/loading";
import { CursorBlastEffect } from "@stackframe/dashboard-ui-components";
import { ConfigUpdateDialogProvider } from "@/lib/config-update";
import { getPublicEnvVar } from '@/lib/env';
import { useStackApp, useUser } from "@stackframe/stack";
import { LOCAL_EMULATOR_ADMIN_EMAIL, LOCAL_EMULATOR_ADMIN_PASSWORD } from "@stackframe/stack-shared/dist/local-emulator";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { useEffect, useRef } from "react";

export default function LayoutClient({ children }: { children: React.ReactNode }) {
  const app = useStackApp();
  const isLocalEmulator = getPublicEnvVar("NEXT_PUBLIC_STACK_IS_LOCAL_EMULATOR") === "true";
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
    if (user || autoLoginStarted.current) return;
    if (!isLocalEmulator || isRemoteDevelopmentEnvironment || isPreview) return;
    autoLoginStarted.current = true;

    const autoLogin = async () => {
      await app.signInWithCredential({
        email: LOCAL_EMULATOR_ADMIN_EMAIL,
        password: LOCAL_EMULATOR_ADMIN_PASSWORD,
      });
    };
    runAsynchronouslyWithAlert(autoLogin());
  }, [user, app, isLocalEmulator, isRemoteDevelopmentEnvironment, isPreview]);

  if ((isLocalEmulator || isRemoteDevelopmentEnvironment || isPreview) && !user) {
    return <Loading />;
  } else {
    return (
      <ConfigUpdateDialogProvider>
        <CursorBlastEffect />
        {children}
      </ConfigUpdateDialogProvider>
    );
  }
}
