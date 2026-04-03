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
        let creds: string | null = null;
        try {
          creds = localStorage.getItem("stack-preview-credentials");
        } catch {
          // localStorage may be blocked in cross-origin iframes
        }
        if (!creds) {
          const id = generateUuid();
          creds = JSON.stringify({
            email: `preview-${id}@preview.stack-auth.com`,
            password: `PreviewPass-${id}`,
          });
          try {
            localStorage.setItem("stack-preview-credentials", creds);
          } catch {
            // localStorage may be blocked in cross-origin iframes
          }
        }
        const { email, password } = JSON.parse(creds);
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
