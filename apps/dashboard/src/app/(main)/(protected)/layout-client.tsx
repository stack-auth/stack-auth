"use client";

import Loading from "@/app/loading";
import { CursorBlastEffect } from "@stackframe/dashboard-ui-components";
import { ConfigUpdateDialogProvider } from "@/lib/config-update";
import { getPublicEnvVar } from '@/lib/env';
import { useStackApp, useUser } from "@stackframe/stack";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { generateUuid } from "@stackframe/stack-shared/dist/utils/uuids";
import { useEffect } from "react";

export default function LayoutClient({ children }: { children: React.ReactNode }) {
  const app = useStackApp();
  const isLocalEmulator = getPublicEnvVar("NEXT_PUBLIC_STACK_IS_LOCAL_EMULATOR") === "true";
  const isPreview = getPublicEnvVar("NEXT_PUBLIC_STACK_IS_PREVIEW") === "true";
  const user = useUser();

  useEffect(() => {
    const autoLogin = async () => {
      if (user) return;
      if (isLocalEmulator) {
        await app.signInWithCredential({
          email: "local-emulator@stack-auth.com",
          password: "LocalEmulatorPassword",
        });
      } else if (isPreview) {
        const id = generateUuid();
        const email = `preview-${id}@preview.stack-auth.com`;
        const password = `PreviewPass-${id}`;
        const signInResult = await app.signInWithCredential({ email, password, noRedirect: true });
        if (signInResult.status === "error") {
          await app.signUpWithCredential({ email, password, noRedirect: true });
        }
      }
    };
    runAsynchronouslyWithAlert(autoLogin());
  }, [user, app, isLocalEmulator, isPreview]);

  if ((isLocalEmulator || isPreview) && !user) {
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
