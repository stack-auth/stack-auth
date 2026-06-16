import { useStackApp } from "@hexclave/react";
import { KeyRound } from "lucide-react";

import { Button } from "~/components/ui";

import type { AuthType } from "./types";

export function PasskeyButton(props: {
  type: AuthType,
}) {
  const app = useStackApp();

  return (
    <Button
      onClick={async () => {
        await app.signInWithPasskey();
      }}
      variant="plain"
      className="stack-scope h-10 rounded-xl border border-transparent bg-primary font-medium text-primary-foreground shadow-sm transition-all duration-150 hover:bg-primary/90"
    >
      <div className="flex w-full items-center gap-4">
        <KeyRound className="size-5" />
        <span className="flex-1">
          {props.type === "sign-up" ? "Sign up with Passkey" : "Sign in with Passkey"}
        </span>
      </div>
    </Button>
  );
}
