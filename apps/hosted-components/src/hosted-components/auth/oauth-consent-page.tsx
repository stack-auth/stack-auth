import { useStackApp, useUser } from "@hexclave/react";
import { useLocation } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useRef } from "react";
import { getOAuthIssuerUrl } from "@hexclave/react/mcp";
import { getApiBaseUrlFromEnv } from "../../routes/__root";
import { Button, Typography } from "~/components/ui";
import { HostedAuthLoading, HostedAuthMessage, HostedAuthShell } from "./supporting/layout";

type ConsentDetails = {
  client_name: string;
  scopes: string[];
  resource: string | null;
  trusted: boolean;
};

export function HostedOAuthConsent(props: { fullPage?: boolean }) {
  const user = useUser({ or: "redirect" });
  const app = useStackApp();
  const location = useLocation();
  const interactionUid = new URLSearchParams(location.searchStr).get("interaction_uid");
  const project = app.useProject();
  const [details, setDetails] = useState<ConsentDetails | undefined>();
  const [error, setError] = useState<string | undefined>();
  const trustedApprovalStarted = useRef(false);
  const apiUrl = getApiBaseUrlFromEnv();

  useEffect(() => {
    if (interactionUid === null) {
      setError("This authorization request is invalid.");
      return;
    }
    void (async () => {
      const token = await app.getAccessToken();
      if (token === null) {
        setError("Sign-in is required.");
        return;
      }
      if (apiUrl === undefined) throw new Error("API URL is not configured.");
      const response = await fetch(
        `${apiUrl}/api/v1/projects/${project.id}/oauth-approval?interaction_uid=${encodeURIComponent(interactionUid)}`,
        { headers: { "x-stack-project-id": project.id, "x-stack-access-token": token } },
      );
      if (!response.ok) throw new Error("Unable to load authorization details.");
      const body = await response.json() as ConsentDetails;
      setDetails(body);
    })().catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : "Unable to load authorization details.");
    });
  }, [app, apiUrl, interactionUid, project.id]);

  const issuer = apiUrl === undefined
    ? undefined
    : getOAuthIssuerUrl({ projectId: project.id, baseUrl: apiUrl });
  const approve = async () => {
    const token = await app.getAccessToken();
    if (token === null || apiUrl === undefined || issuer === undefined) {
      setError("Unable to authorize this request.");
      return;
    }
    const response = await fetch(`${apiUrl}/api/v1/projects/${project.id}/oauth-approval`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-stack-project-id": project.id, "x-stack-access-token": token },
      body: JSON.stringify({ interaction_uid: interactionUid }),
    });
    if (!response.ok) throw new Error("Unable to approve authorization.");
    const body = await response.json() as { code: string };
    window.location.assign(`${issuer}/interaction/${encodeURIComponent(interactionUid ?? "")}/done?code=${encodeURIComponent(body.code)}`);
  };

  useEffect(() => {
    if (details?.trusted === true && interactionUid !== null && trustedApprovalStarted.current === false) {
      trustedApprovalStarted.current = true;
      approve().catch(() => setError("Unable to approve authorization."));
    }
  }, [details?.trusted, interactionUid]);

  if (error !== undefined) {
    return (
      <HostedAuthMessage
        title="Authorization Failed"
        primaryAction={() => app.redirectToHome()}
        primaryText="Go home"
        fullPage={props.fullPage}
      >
        {error}
      </HostedAuthMessage>
    );
  }
  if (details === undefined || interactionUid === null) return <HostedAuthLoading fullPage={props.fullPage} />;

  if (details.trusted) {
    return <HostedAuthLoading fullPage={props.fullPage} />;
  }
  return (
    <HostedAuthShell fullPage={props.fullPage}>
      <Typography type="h2" className="mb-2 text-xl font-semibold tracking-tight">Authorize {details.client_name}</Typography>
      <Typography className="text-sm text-muted-foreground">This application requests access to your account.</Typography>
      {details.resource !== null && <Typography className="mt-4 text-sm">Resource: {details.resource}</Typography>}
      <ul className="mt-4 list-disc pl-5 text-sm">{details.scopes.map(scope => <li key={scope}>{scope}</li>)}</ul>
      <div className="mt-6 flex flex-col gap-2.5">
        <Button onClick={approve} className="h-10 rounded-xl font-semibold">Authorize</Button>
        <Button
          variant="secondary"
          onClick={() => window.location.assign(`${issuer ?? ""}/interaction/${encodeURIComponent(interactionUid)}/done?error=access_denied`)}
          className="h-10 rounded-xl font-semibold"
        >
          Cancel
        </Button>
      </div>
    </HostedAuthShell>
  );
}
