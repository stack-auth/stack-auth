'use client';

import { DesignButton } from "@/components/design-components";
import { Typography } from "@/components/ui";
import { useCliAuthConfirmation, useStackApp } from "@hexclave/next";
import { CheckCircleIcon, SpinnerGapIcon, TerminalWindowIcon, WarningCircleIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";

type CliAuthPreviewStatus = "success" | "error" | "invalid";

function getCliAuthPreviewStatus(): CliAuthPreviewStatus | null {
  if (typeof window === "undefined") return null;
  const preview = new URLSearchParams(window.location.search).get("preview");
  if (preview === "success" || preview === "error" || preview === "invalid") {
    return preview;
  }
  return null;
}

function CliAuthPage(props: {
  icon: ReactNode,
  title: string,
  description: ReactNode,
  children?: ReactNode,
}) {
  return (
    <div className="flex flex-1 items-center justify-center p-4 sm:p-6">
      <div className="flex w-full max-w-[360px] flex-col items-center text-center">
        {props.icon}
        <Typography className="mt-6 text-xl font-semibold tracking-tight text-foreground">
          {props.title}
        </Typography>
        <Typography className="mt-2 max-w-[34ch] text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          {props.description}
        </Typography>
        {props.children != null && (
          <div className="mt-8 flex w-full flex-col gap-2">
            {props.children}
          </div>
        )}
      </div>
    </div>
  );
}

function CliAuthIcon(props: { children: ReactNode }) {
  return (
    <div className="flex h-12 w-12 items-center justify-center rounded-full border border-zinc-200 bg-zinc-50 text-zinc-900 dark:border-white/10 dark:bg-white/[0.06] dark:text-white">
      {props.children}
    </div>
  );
}

export function DashboardCliAuthConfirmPage() {
  const app = useStackApp();
  const cliAuth = useCliAuthConfirmation();
  const status = getCliAuthPreviewStatus() ?? cliAuth.status;

  if (status === "success") {
    return (
      <CliAuthPage
        icon={(
          <CliAuthIcon>
            <CheckCircleIcon className="h-5 w-5 text-emerald-600 dark:text-emerald-400" weight="bold" aria-hidden />
          </CliAuthIcon>
        )}
        title="Device connected"
        description="You can close this window and return to your terminal."
      />
    );
  }

  if (status === "error") {
    return (
      <CliAuthPage
        icon={(
          <CliAuthIcon>
            <WarningCircleIcon className="h-5 w-5 text-destructive" weight="bold" aria-hidden />
          </CliAuthIcon>
        )}
        title="Authorization failed"
        description="Something went wrong. Try again, or restart the sign-in from your terminal."
      >
        <DesignButton onClick={cliAuth.retry} className="w-full">
          Try again
        </DesignButton>
        <DesignButton
          variant="ghost"
          onClick={() => app.redirectToHome()}
          className="w-full text-zinc-600 dark:text-zinc-400"
        >
          Cancel
        </DesignButton>
      </CliAuthPage>
    );
  }

  if (status === "invalid") {
    return (
      <CliAuthPage
        icon={(
          <CliAuthIcon>
            <WarningCircleIcon className="h-5 w-5 text-destructive" weight="bold" aria-hidden />
          </CliAuthIcon>
        )}
        title="Invalid link"
        description="This link is missing a login code. Restart the sign-in from your terminal to get a new one."
      />
    );
  }

  if (status === "authorizing" || status === "redirecting") {
    return (
      <CliAuthPage
        icon={(
          <CliAuthIcon>
            <SpinnerGapIcon className="h-5 w-5 animate-spin" aria-hidden />
          </CliAuthIcon>
        )}
        title="Connecting…"
        description="Finishing the authorization."
      />
    );
  }

  return (
    <CliAuthPage
      icon={(
        <CliAuthIcon>
          <TerminalWindowIcon className="h-5 w-5" weight="bold" aria-hidden />
        </CliAuthIcon>
      )}
      title="Authorize CLI"
      description="A command line application wants to sign in to your account."
    >
      <DesignButton
        onClick={cliAuth.authorize}
        loading={cliAuth.isLoading}
        className="w-full"
      >
        Authorize
      </DesignButton>
      <DesignButton
        variant="ghost"
        onClick={() => app.redirectToHome()}
        disabled={cliAuth.isLoading}
        className="w-full text-zinc-600 dark:text-zinc-400"
      >
        Cancel
      </DesignButton>
    </CliAuthPage>
  );
}
