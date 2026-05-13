"use client";

import { ProjectTransferConfirmView, type ProjectTransferConfirmUiState } from "@/components/project-transfer-confirm-view";
import { useRouter } from "@/components/router";
import { stackAppInternalsSymbol } from "@/lib/stack-app-internals";
import { useStackApp, useUser } from "@stackframe/stack";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { runAsynchronously, wait } from "@stackframe/stack-shared/dist/utils/promises";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

function buildSignUpUrl(): string {
  const currentUrl = new URL(window.location.href);
  const signUpSearchParams = new URLSearchParams();
  signUpSearchParams.set("after_auth_return_to", currentUrl.pathname + currentUrl.search + currentUrl.hash);
  return `/handler/signup?${signUpSearchParams.toString()}`;
}

/** Custom integration project transfer — design-components UI. Neon uses `neon-transfer-confirm-page`. */
export default function CustomIntegrationProjectTransferConfirmPageClient() {
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
      } catch (err: unknown) {
        console.error("Project transfer confirm check failed:", err);
        setState({
          type: "error",
          message: "This transfer link is invalid, has expired, or has already been used. Open the original link from the partner or integrations dashboard, or start the transfer again.",
        });
      }
    });
  }, [app, searchParams]);

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
          if (typeof confirmResJson?.project_id !== "string") {
            throw new StackAssertionError("Project transfer confirm response is missing `project_id`", { confirmResJson });
          }
          router.push(`/projects/${confirmResJson.project_id}`);
          await wait(3000);
        } else {
          router.push(buildSignUpUrl());
          await wait(3000);
        }
      }}
      onSwitchAccount={async () => {
        if (user == null) {
          return;
        }
        await user.signOut({ redirectUrl: buildSignUpUrl() });
      }}
    />
  );
}
