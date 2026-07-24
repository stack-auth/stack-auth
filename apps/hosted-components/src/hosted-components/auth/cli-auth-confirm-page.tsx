import { useStackApp, useCliAuthConfirmation } from "@hexclave/react";
import { Check, CircleAlert, Terminal } from "lucide-react";
import type { ReactNode } from "react";

import { Button, Spinner, Typography } from "~/components/ui";

import { HostedAuthShell } from "./supporting/layout";

function CliAuthPage(props: {
  icon: ReactNode,
  title: string,
  description: ReactNode,
  children?: ReactNode,
  fullPage?: boolean,
}) {
  return (
    <HostedAuthShell fullPage={props.fullPage}>
      <div className="flex flex-col items-center text-center">
        {props.icon}
        <Typography type="h1" className="mt-6 text-xl font-semibold tracking-tight">
          {props.title}
        </Typography>
        <Typography className="mt-2 max-w-[34ch] text-sm leading-6 text-muted-foreground">
          {props.description}
        </Typography>
      </div>
      {props.children != null && <div className="mt-8 flex flex-col gap-2">{props.children}</div>}
    </HostedAuthShell>
  );
}

function CliAuthIcon(props: { children: ReactNode }) {
  return (
    <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border/60 bg-muted/50">
      {props.children}
    </div>
  );
}

export function HostedCliAuthConfirm(props: {
  fullPage?: boolean,
}) {
  const app = useStackApp();
  const cliAuth = useCliAuthConfirmation();

  if (cliAuth.status === "success") {
    return (
      <CliAuthPage
        icon={<CliAuthIcon><Check className="h-5 w-5 text-emerald-600 dark:text-emerald-400" aria-hidden /></CliAuthIcon>}
        title="Device connected"
        description="You can close this window and return to your terminal."
        fullPage={props.fullPage}
      />
    );
  }

  if (cliAuth.status === "error") {
    return (
      <CliAuthPage
        icon={<CliAuthIcon><CircleAlert className="h-5 w-5 text-destructive" aria-hidden /></CliAuthIcon>}
        title="Authorization failed"
        description="Something went wrong. Try again, or restart the sign-in from your terminal."
        fullPage={props.fullPage}
      >
        <Button onClick={cliAuth.retry} className="h-10 rounded-lg">
          Try again
        </Button>
        <Button variant="ghost" onClick={() => app.redirectToHome()} className="h-10 rounded-lg text-muted-foreground">
          Cancel
        </Button>
      </CliAuthPage>
    );
  }

  if (cliAuth.status === "invalid") {
    return (
      <CliAuthPage
        icon={<CliAuthIcon><CircleAlert className="h-5 w-5 text-destructive" aria-hidden /></CliAuthIcon>}
        title="Invalid link"
        description="This link is missing a login code. Restart the sign-in from your terminal to get a new one."
        fullPage={props.fullPage}
      />
    );
  }

  if (cliAuth.status === "authorizing" || cliAuth.status === "redirecting") {
    return (
      <CliAuthPage
        icon={<CliAuthIcon><Spinner size={20} className="text-muted-foreground" /></CliAuthIcon>}
        title="Connecting…"
        description="Finishing the authorization."
        fullPage={props.fullPage}
      />
    );
  }

  return (
    <CliAuthPage
      icon={<CliAuthIcon><Terminal className="h-5 w-5 text-foreground" aria-hidden /></CliAuthIcon>}
      title="Authorize CLI"
      description="A command line application wants to sign in to your account."
      fullPage={props.fullPage}
    >
      <Button
        onClick={cliAuth.authorize}
        disabled={cliAuth.isLoading}
        className="h-10 rounded-lg"
      >
        {cliAuth.isLoading ? "Authorizing…" : "Authorize"}
      </Button>
      <Button
        variant="ghost"
        onClick={() => app.redirectToHome()}
        disabled={cliAuth.isLoading}
        className="h-10 rounded-lg text-muted-foreground"
      >
        Cancel
      </Button>
    </CliAuthPage>
  );
}
