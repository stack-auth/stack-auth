"use client";

import { ProjectTransferConfirmView, type ProjectTransferConfirmUiState } from "@/components/project-transfer-confirm-view";
import { useRouter } from "@/components/router";
import { buildTransferSignUpUrl, getStackAppInternals } from "@/lib/transfer-utils";
import { useStackApp, useUser } from "@stackframe/stack";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { runAsynchronously, wait } from "@stackframe/stack-shared/dist/utils/promises";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

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
        await getStackAppInternals(app).sendRequest("/integrations/custom/projects/transfer/confirm/check", {
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
          const confirmRes = await getStackAppInternals(app).sendRequest("/integrations/custom/projects/transfer/confirm", {
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
          router.push(buildTransferSignUpUrl());
          await wait(3000);
        }
      }}
      onSwitchAccount={async () => {
        if (user == null) {
          return;
        }
        await user.signOut({ redirectUrl: buildTransferSignUpUrl() });
      }}
    />
  );
}
