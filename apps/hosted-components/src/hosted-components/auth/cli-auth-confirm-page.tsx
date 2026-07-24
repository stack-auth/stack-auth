import { useStackApp, useCliAuthConfirmation } from "@hexclave/react";
import { KeyRound } from "lucide-react";

import { Button, Typography } from "~/components/ui";

import { HostedAuthLoading, HostedAuthMessage, HostedAuthShell } from "./supporting/layout";

export function HostedCliAuthConfirm(props: {
  fullPage?: boolean,
}) {
  const app = useStackApp();
  const cliAuth = useCliAuthConfirmation();

  if (cliAuth.status === "success") {
    return (
      <HostedAuthMessage
        title="CLI Authorized Successfully"
        primaryAction={() => app.redirectToHome()}
        primaryText="Go home"
        fullPage={props.fullPage}
      >
        The CLI application has been authorized successfully. You can close this window and return to the command line.
      </HostedAuthMessage>
    );
  }

  if (cliAuth.status === "error") {
    return (
      <HostedAuthMessage
        title="Authorization Failed"
        primaryAction={cliAuth.retry}
        primaryText="Try again"
        secondaryAction={() => app.redirectToHome()}
        secondaryText="Cancel"
        fullPage={props.fullPage}
      >
        <div className="flex flex-col gap-1 text-center">
          <Typography className="text-sm text-destructive">
            Failed to authorize the CLI application:
          </Typography>
          <Typography className="text-xs text-muted-foreground font-mono bg-muted p-2 rounded-lg break-all">
            This authorization request could not be completed. Please try again.
          </Typography>
        </div>
      </HostedAuthMessage>
    );
  }

  if (cliAuth.status === "invalid") {
    return (
      <HostedAuthMessage
        title="Invalid Authorization Link"
        primaryAction={() => app.redirectToHome()}
        primaryText="Go home"
        fullPage={props.fullPage}
      >
        This CLI authorization link is missing a login code. Please return to the command line and start the login process again.
      </HostedAuthMessage>
    );
  }

  if (cliAuth.status === "authorizing" || cliAuth.status === "redirecting") {
    return <HostedAuthLoading fullPage={props.fullPage} />;
  }

  return (
    <HostedAuthShell fullPage={props.fullPage}>
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <KeyRound className="h-6 w-6" />
        </div>
        <Typography type="h2" className="mb-2 text-xl font-semibold tracking-tight">
          Authorize CLI Application
        </Typography>
        <Typography className="text-sm text-muted-foreground">
          A command line application is requesting access to your account. Clicking authorize will grant a secure access token to the CLI.
        </Typography>
      </div>

      <div className="mt-6 rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-left">
        <Typography className="text-xs font-semibold text-destructive mb-1 uppercase tracking-wider">
          Security Warning
        </Typography>
        <Typography className="text-xs text-muted-foreground leading-relaxed">
          Make sure you trust the command line application, as it will gain access to your account. If you did not initiate this request, please close this page and ignore it.
        </Typography>
      </div>

      <div className="mt-6 flex flex-col gap-2.5">
        <Button
          onClick={cliAuth.authorize}
          disabled={cliAuth.isLoading}
          className="h-10 rounded-xl font-semibold shadow-sm hover:shadow"
        >
          {cliAuth.isLoading ? "Authorizing..." : "Authorize"}
        </Button>
        <Button
          variant="secondary"
          onClick={() => app.redirectToHome()}
          disabled={cliAuth.isLoading}
          className="h-10 rounded-xl font-semibold"
        >
          Cancel
        </Button>
      </div>
    </HostedAuthShell>
  );
}
