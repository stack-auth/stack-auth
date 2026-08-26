import { useStackApp, useUser } from "@hexclave/react";
import { throwErr } from "@hexclave/shared/dist/utils/errors";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { useCallback, useEffect, useRef, useState } from "react";
import { getApiBaseUrlFromEnv } from "~/lib/api-base-url";
import { Button, Typography } from "~/components/ui";
import {
  HostedAuthHeading,
  HostedAuthLoading,
  HostedAuthMessage,
  HostedAuthShell,
} from "./auth/supporting/layout";

type InteractionDetails = {
  client: { id: string, display_name: string },
  resource: { uri: string, display_name: string } | null,
  trusted_client: boolean,
};

async function getProjectClientRequestHeaders(app: {
  projectId: string,
  getAccessToken: () => Promise<string | null>,
}): Promise<Record<string, string>> {
  const token = await app.getAccessToken();
  if (token == null) throw new Error("Your session expired. Please sign in again.");
  return {
    "x-stack-access-type": "client",
    "x-stack-project-id": app.projectId,
    "x-stack-access-token": token,
  };
}

export function HostedOAuthProviderInteraction() {
  const app = useStackApp();
  const user = useUser({ or: "return-null" });
  const [details, setDetails] = useState<InteractionDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);
  const loadStateRef = useRef<{ interactionUid: string | null, status: "idle" | "loading" | "done" | "error" }>({ interactionUid: null, status: "idle" });
  const trustedCompletionStartedRef = useRef(false);
  const interactionUid = new URLSearchParams(window.location.search).get("interaction_uid");
  const apiBaseUrl = getApiBaseUrlFromEnv() ?? throwErr("A hosted components API base URL is required. Set VITE_HEXCLAVE_API_URL or VITE_STACK_API_URL.");

  useEffect(() => {
    if (user == null) {
      runAsynchronously(app.redirectToSignIn());
    }
  }, [app, user]);

  useEffect(() => {
    if (user == null || interactionUid == null) return;
    if (loadStateRef.current.interactionUid === interactionUid && loadStateRef.current.status !== "idle") return;
    loadStateRef.current = { interactionUid, status: "loading" };
    let cancelled = false;
    const load = async () => {
      try {
        const headers = await getProjectClientRequestHeaders(app);
        const response = await fetch(
          `${apiBaseUrl}/api/v1/projects/${encodeURIComponent(app.projectId)}/oauth-provider/interaction/${encodeURIComponent(interactionUid)}`,
          { headers },
        );
        const body: unknown = await response.json();
        if (!response.ok) {
          if (!cancelled) {
            loadStateRef.current = { interactionUid, status: "error" };
            setError("This authorization request is expired or no longer available.");
          }
          return;
        }
        if (cancelled) return;
        if (!isInteractionDetails(body)) {
          loadStateRef.current = { interactionUid, status: "error" };
          setError("The authorization request returned invalid details.");
          return;
        }
        loadStateRef.current = { interactionUid, status: "done" };
        setDetails(body);
      } catch {
        if (!cancelled) {
          loadStateRef.current = { interactionUid, status: "error" };
          setError("This authorization request is expired or no longer available.");
        }
      }
    };
    runAsynchronously(load());
    return () => {
      cancelled = true;
      if (
        loadStateRef.current.interactionUid === interactionUid
        && loadStateRef.current.status === "loading"
      ) {
        // StrictMode replays this effect after cleanup; forget the cancelled
        // request so the replay can replace it instead of leaving the page loading forever.
        loadStateRef.current = { interactionUid, status: "idle" };
      }
    };
  }, [app, interactionUid, user?.id]);

  const finish = useCallback(async (denied: boolean) => {
    setRedirecting(true);
    try {
      const headers = await getProjectClientRequestHeaders(app);
      const uid = interactionUid ?? throwErr("An interaction ID is required to complete OAuth authorization.");
      const response = await fetch(
        `${apiBaseUrl}/api/v1/projects/${encodeURIComponent(app.projectId)}/oauth-provider/interaction/${encodeURIComponent(uid)}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...headers,
          },
          body: JSON.stringify({ denied }),
        },
      );
      const body: unknown = await response.json();
      if (!response.ok || typeof body !== "object" || body == null || !("done_url" in body) || typeof body.done_url !== "string") {
        setRedirecting(false);
        setError(denied ? "Unable to deny this authorization request." : "Unable to complete this authorization request.");
        return;
      }
      window.location.assign(body.done_url);
    } catch {
      setRedirecting(false);
      setError("We couldn't complete this authorization request. Please return to the application and try again.");
    }
  }, [apiBaseUrl, app, interactionUid]);

  useEffect(() => {
    if (details?.trusted_client !== true || trustedCompletionStartedRef.current) return;
    trustedCompletionStartedRef.current = true;
    runAsynchronously(finish(false));
  }, [details?.trusted_client, finish]);

  if (interactionUid == null) {
    return <HostedAuthMessage title="Invalid authorization request" fullPage>Please return to the application that started sign-in.</HostedAuthMessage>;
  }
  if (error != null) {
    return <HostedAuthMessage title="Authorization unavailable" fullPage>{error}</HostedAuthMessage>;
  }
  if (user == null || redirecting) return <HostedAuthLoading fullPage />;
  if (details == null) return <HostedAuthLoading fullPage />;

  if (details.trusted_client) {
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
      <div className="mt-6 flex flex-col gap-2.5">
        <Button onClick={() => finish(false)} className="h-10 rounded-xl font-semibold">Approve</Button>
        <Button variant="secondary" onClick={() => finish(true)} className="h-10 rounded-xl font-semibold">Deny</Button>
      </div>
    </HostedAuthShell>
  );
}

function isInteractionDetails(value: unknown): value is InteractionDetails {
  if (typeof value !== "object" || value == null) return false;
  return "client" in value && "resource" in value && "trusted_client" in value;
}
