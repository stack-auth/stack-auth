'use client';

import Loading from "@/app/loading";
import { useStackApp, useUser } from "@stackframe/stack";
import { getPublicEnvVar } from '@/lib/env';
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { useEffect } from "react";

export default function Layout({ children }: { children: React.ReactNode }) {
  const app = useStackApp();
  const user = useUser();

  useEffect(() => {
    const signIn = async () => {
      if (getPublicEnvVar("NEXT_PUBLIC_STACK_EMULATOR_ENABLED") === "true" && !user) {
        await app.signInWithCredential({
          email: "local-emulator@stack-auth.com",
          password: "LocalEmulatorPassword",
        });
      }
    };
    runAsynchronouslyWithAlert(signIn());
  }, [user, app]);

  if (getPublicEnvVar("NEXT_PUBLIC_STACK_EMULATOR_ENABLED") === "true" && !user) {
    return <Loading />;
  } else {
    return <>{children}</>;
  }
}
