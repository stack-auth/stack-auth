"use client";

import { Button, Input } from "@/components/ui";
import { DesignAlert, DesignCard } from "@/components/design-components";
import { CheckCircleIcon } from "@phosphor-icons/react";
import { hexclaveAppInternalsSymbol, useStackApp, useUser } from "@hexclave/next";
import { useEffect, useMemo, useState } from "react";
import { AppEnabledGuard } from "../../app-enabled-guard";
import { PageLayout } from "../../page-layout";
import { useAdminApp } from "../../use-admin-app";
import { usePathname, useSearchParams } from "next/navigation";

function isTokenResponse(value: unknown): value is { access_token: string, refresh_token: string } {
  return typeof value === "object" && value != null
    && Reflect.get(value, "access_token") != null
    && typeof Reflect.get(value, "access_token") === "string"
    && Reflect.get(value, "refresh_token") != null
    && typeof Reflect.get(value, "refresh_token") === "string";
}

export default function PageClient() {
  const hexclaveAdminApp = useAdminApp();
  const project = hexclaveAdminApp.useProject();
  const config = project.useConfig();
  const app = useStackApp();
  const user = useUser();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const claimAttemptToken = searchParams.get("claim_attempt_token");
  const [userCode, setUserCode] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (user == null) {
      app.redirectToSignIn().catch(() => undefined);
    }
  }, [app, user]);

  const userLabel = user?.displayName ?? user?.primaryEmail ?? "your account";
  const isValidUserCode = useMemo(() => /^\d{6}$/.test(userCode), [userCode]);

  const handleSubmit = async () => {
    setSubmitError(null);

    if (claimAttemptToken == null) {
      setSubmitError("Missing claim_attempt_token in the URL.");
      throw new Error("Missing claim_attempt_token in the URL.");
    }

    if (!isValidUserCode) {
      setSubmitError("Enter the 6-digit user code shown by the agent.");
      throw new Error("Enter the 6-digit user code shown by the agent.");
    }

    const response = await app[hexclaveAppInternalsSymbol].sendRequest(
      `/api/v1/projects/${project.id}/agent/identity/claim/complete`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          claim_attempt_token: claimAttemptToken,
          user_code: userCode,
        }),
      },
      "client",
    );

    if (!response.ok) {
      const text = await response.text();
      setSubmitError(text);
      throw new Error(text);
    }

    const data: unknown = await response.json();
    if (!isTokenResponse(data)) {
      throw new Error("Unexpected completion response");
    }

    await app[hexclaveAppInternalsSymbol].signInWithTokens({
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
    });
    setSuccess(true);
  };

  return (
    <AppEnabledGuard appId="agent-auth">
      <PageLayout title="Claim Agent Auth Registration" description="Complete the agent registration claim step for this project">
        <DesignCard
          title="Complete the claim"
          subtitle={`You're signed in as ${userLabel}. Enter the 6-digit code shown to the agent.`}
          icon={CheckCircleIcon}
          glassmorphic
        >
          {submitError != null && (
            <DesignAlert variant="error" title="Claim failed" description={submitError} />
          )}
          {success ? (
            <DesignAlert
              variant="success"
              title="Claim completed"
              description="The registration has been bound to your account."
            />
          ) : (
            <div className="flex flex-col gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground" htmlFor="user-code">
                  6-digit code
                </label>
                <Input
                  id="user-code"
                  value={userCode}
                  onChange={(event) => setUserCode(event.target.value.replace(/\s+/g, ""))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123456"
                />
              </div>
              <div className="flex items-center gap-3">
                <Button onClick={handleSubmit} disabled={!isValidUserCode}>
                  Complete claim
                </Button>
                <span className="text-sm text-muted-foreground">
                  {pathname}
                </span>
              </div>
            </div>
          )}
        </DesignCard>
      </PageLayout>
    </AppEnabledGuard>
  );
}
