import { useStackApp, useUser } from "@hexclave/react";
import { throwErr } from "@hexclave/shared/dist/utils/errors";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { useEffect, useState } from "react";
import { getApiBaseUrlFromEnv } from "~/lib/api-base-url";
import { Button, Checkbox, Typography } from "~/components/ui";
import {
  HostedAuthHeading,
  HostedAuthLoading,
  HostedAuthMessage,
  HostedAuthShell,
} from "./auth/supporting/layout";

type InteractionDetails = {
  client: { id: string, display_name: string },
  scopes: Array<{ scope: string, display_name: string, description: string }>,
  resource: { uri: string, display_name: string } | null,
  trusted_client: boolean,
  allow_user_to_deselect_optional_scopes: boolean,
};

export function HostedOAuthProviderInteraction() {
  const app = useStackApp();
  const user = useUser({ or: "return-null" });
  const [details, setDetails] = useState<InteractionDetails | null>(null);
  const [selectedScopes, setSelectedScopes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);
  const interactionUid = new URLSearchParams(window.location.search).get("interaction_uid");
  const apiBaseUrl = getApiBaseUrlFromEnv() ?? throwErr("A hosted components API base URL is required. Set VITE_HEXCLAVE_API_URL or VITE_STACK_API_URL.");

  useEffect(() => {
    if (user == null) {
      runAsynchronously(app.redirectToSignIn());
    }
  }, [app, user]);

  useEffect(() => {
    if (user == null || interactionUid == null) return;
    let cancelled = false;
    const load = async () => {
      try {
        const token = await app.getAccessToken();
        if (token == null) throw new Error("Your session expired. Please sign in again.");
        const response = await fetch(
          `${apiBaseUrl}/api/v1/projects/${encodeURIComponent(app.projectId)}/oauth-provider/interaction/${encodeURIComponent(interactionUid)}`,
          { headers: { "x-stack-access-token": token } },
        );
        const body: unknown = await response.json();
        if (!response.ok) throw new Error("This authorization request is expired or no longer available.");
        if (cancelled) return;
        if (!isInteractionDetails(body)) throw new Error("The authorization request returned invalid details.");
        const nextDetails = body;
        setDetails(nextDetails);
        setSelectedScopes(nextDetails.scopes.map(scope => scope.scope));
      } catch (loadError) {
        if (!cancelled) {
          setError("This authorization request is expired or no longer available.");
        }
      }
    };
    runAsynchronously(load());
    return () => {
      cancelled = true;
    };
  }, [app, interactionUid, user]);

  if (interactionUid == null) {
    return <HostedAuthMessage title="Invalid authorization request" fullPage>Please return to the application that started sign-in.</HostedAuthMessage>;
  }
  if (user == null || redirecting) return <HostedAuthLoading fullPage />;
  if (error != null) {
    return <HostedAuthMessage title="Authorization unavailable" fullPage>{error}</HostedAuthMessage>;
  }
  if (details == null) return <HostedAuthLoading fullPage />;

  const finish = async (denied: boolean) => {
    setRedirecting(true);
    try {
      const token = await app.getAccessToken();
      if (token == null) throw new Error("Your session expired. Please sign in again.");
      const response = await fetch(
        `${apiBaseUrl}/api/v1/projects/${encodeURIComponent(app.projectId)}/oauth-provider/interaction/${encodeURIComponent(interactionUid)}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-stack-access-token": token,
          },
          body: JSON.stringify({
            approved_scopes: denied ? [] : selectedScopes,
            denied,
          }),
        },
      );
      const body: unknown = await response.json();
      if (!response.ok || typeof body !== "object" || body == null || !("done_url" in body) || typeof body.done_url !== "string") {
        throw new Error(denied ? "Unable to deny this authorization request." : "Unable to complete this authorization request.");
      }
      window.location.assign(body.done_url);
    } catch (finishError) {
      setRedirecting(false);
      setError("We couldn't complete this authorization request. Please return to the application and try again.");
    }
  };

  if (details.trusted_client) {
    runAsynchronously(finish(false));
    return <HostedAuthLoading fullPage />;
  }

  return (
    <HostedAuthShell fullPage>
      <HostedAuthHeading title="Authorize application">
        <span>{details.client.display_name}</span> is requesting access to your account.
      </HostedAuthHeading>
      {details.resource != null && (
        <div className="mb-5 rounded-xl border border-black/[0.08] bg-muted/30 p-4 dark:border-white/[0.12]">
          <Typography className="text-sm font-semibold">Resource</Typography>
          <Typography className="mt-1 text-sm text-muted-foreground">{details.resource.display_name}</Typography>
        </div>
      )}
      <div className="space-y-3">
        <Typography className="text-sm font-semibold">Permissions</Typography>
        {details.scopes.map(scope => (
          <label key={scope.scope} className="flex gap-3 rounded-xl border border-black/[0.08] p-3 dark:border-white/[0.12]">
            <Checkbox
              checked={selectedScopes.includes(scope.scope)}
              disabled={!details.allow_user_to_deselect_optional_scopes}
              onCheckedChange={(checked: boolean | "indeterminate") => {
                if (checked === true) setSelectedScopes(current => [...new Set([...current, scope.scope])]);
                else setSelectedScopes(current => current.filter(value => value !== scope.scope));
              }}
            />
            <span>
              <Typography className="text-sm font-medium">{scope.display_name}</Typography>
              <Typography className="text-xs text-muted-foreground">{scope.description}</Typography>
            </span>
          </label>
        ))}
      </div>
      <div className="mt-6 flex flex-col gap-2.5">
        <Button onClick={() => finish(false)} className="h-10 rounded-xl font-semibold">Approve</Button>
        <Button variant="secondary" onClick={() => finish(true)} className="h-10 rounded-xl font-semibold">Deny</Button>
      </div>
    </HostedAuthShell>
  );
}

function isInteractionDetails(value: unknown): value is InteractionDetails {
  if (typeof value !== "object" || value == null) return false;
  return "client" in value && "scopes" in value && Array.isArray(value.scopes)
    && "trusted_client" in value && "allow_user_to_deselect_optional_scopes" in value;
}
