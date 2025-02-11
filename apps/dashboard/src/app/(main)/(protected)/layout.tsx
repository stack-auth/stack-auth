'use client';

import { useStackApp, useUser } from "@stackframe/stack";
import { getPublicEnvVar } from '@stackframe/stack-shared/dist/utils/env';
import { useEffect } from "react";

export default function Layout({ children }: { children: React.ReactNode }) {
  const app = useStackApp();
  const user = useUser();

  useEffect(() => {
    const signIn = async () => {
      if (getPublicEnvVar("NEXT_PUBLIC_STACK_EMULATOR_ENABLED") === "true" && !user) {
        await app.signInWithCredential({
          email: "local-emulator@email.com",
          password: "LocalEmulatorPassword123",
        });
      }
    };
    // runAsynchronouslyWithAlert(signIn());
    signIn().catch(console.error);
  }, [user, app]);

  if (getPublicEnvVar("NEXT_PUBLIC_STACK_EMULATOR_ENABLED") === "true" && !user) {
    return <>You will be redirected in a few seconds.</>;
  } else {
    return <>{children}</>;
  }
}
