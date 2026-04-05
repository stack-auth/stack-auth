"use client";

import { DesignAlert } from "@/components/design-components/alert";
import { ProjectTransferConfirmView, type ProjectTransferConfirmUiState } from "@/components/project-transfer-confirm-view";
import { useRouter } from "@/components/router";
import { stackAppInternalsSymbol } from "@/lib/stack-app-internals";
import { useStackApp, useUser } from "@stackframe/stack";
import { runAsynchronously, wait } from "@stackframe/stack-shared/dist/utils/promises";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

export function TransferConfirmMissingCodeView() {
  return (
    <div className="flex min-h-[100dvh] w-full items-center justify-center px-4 py-8 sm:px-6">
      <DesignAlert
        variant="error"
        title="This transfer link is incomplete"
        description="Open the full link you received (it includes a transfer code). If the link expired, go back to the partner or integrations screen and start the transfer again."
        className="max-w-md"
      />
    </div>
  );
}

/** Custom integration project transfer — design-components UI. Neon uses `neon-transfer-confirm-page`. */
export default function IntegrationProjectTransferConfirmPageClient() {
  const app = useStackApp();
  const user = useUser({ projectIdMustMatch: "internal" });
  const router = useRouter();
  const searchParams = useSearchParams();

  const [state, setState] = useState<ProjectTransferConfirmUiState>("loading");

  useEffect(() => {
    runAsynchronously(async () => {
      try {
        await (app as any)[stackAppInternalsSymbol].sendRequest("/integrations/custom/projects/transfer/confirm/check", {
          method: "POST",
          body: JSON.stringify({
            code: searchParams.get("code"),
          }),
          headers: {
            "Content-Type": "application/json",
          },
        });
        setState("success");
      } catch (err: any) {
        setState({ type: "error", message: err.message });
      }
    });
  }, [app, searchParams]);

  const currentUrl = new URL(window.location.href);
  const signUpSearchParams = new URLSearchParams();
  signUpSearchParams.set("after_auth_return_to", currentUrl.pathname + currentUrl.search + currentUrl.hash);
  const signUpUrl = `/handler/signup?${signUpSearchParams.toString()}`;

  const signedIn = user != null;
  const accountLabel = user
    ? `Signed in as ${user.primaryEmail ?? user.displayName ?? "Unnamed user"}`
    : undefined;

  return (
    <ProjectTransferConfirmView
      state={state}
      signedIn={signedIn}
      signedInAsLabel={accountLabel}
      onCancel={() => {
        window.close();
      }}
      onPrimary={async () => {
        if (user) {
          const confirmRes = await (app as any)[stackAppInternalsSymbol].sendRequest("/integrations/custom/projects/transfer/confirm", {
            method: "POST",
            body: JSON.stringify({
              code: searchParams.get("code"),
            }),
            headers: {
              "Content-Type": "application/json",
            },
          });
          const confirmResJson = await confirmRes.json();
          router.push(`/projects/${confirmResJson.project_id}`);
          await wait(3000);
        } else {
          router.push(signUpUrl);
          await wait(3000);
        }
      }}
      onSwitchAccount={async () => {
        if (user == null) {
          return;
        }
        await user.signOut({ redirectUrl: signUpUrl });
      }}
    />
  );
}
