import React from "react";

import { Button, Spinner, Typography, cn } from "~/components/ui";

export const authFooterClassName = "mt-6 border-t border-black/[0.06] pt-5 text-center text-sm dark:border-white/[0.10]";
export const authFooterLinkClassName = "font-medium text-foreground/90 underline-offset-4 transition-colors hover:text-foreground hover:underline";

export function HostedAuthShell(props: {
  children: React.ReactNode,
  fullPage?: boolean,
  paddedFullPage?: boolean,
}) {
  const content = (
    <div
      className={cn(
        "stack-scope relative z-10 flex w-full max-w-[400px] flex-col items-stretch text-foreground",
        props.fullPage && props.paddedFullPage !== false ? "p-4 sm:p-6" : "p-0",
      )}
    >
      {props.children}
    </div>
  );

  if (!props.fullPage) {
    return content;
  }

  return (
    <div
      data-hexclave-handler-page
      className="stack-scope relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-background p-4 sm:p-6"
    >
      {content}
    </div>
  );
}

export function HostedAuthHeading(props: {
  title: string,
  children?: React.ReactNode,
}) {
  return (
    <div className="mb-6 text-center">
      <Typography type="h2" className="mb-1 text-xl font-semibold tracking-tight">{props.title}</Typography>
      {props.children != null && (
        <Typography className="text-sm text-muted-foreground">{props.children}</Typography>
      )}
    </div>
  );
}

export function HostedAuthMessage(props: {
  title: string,
  children: React.ReactNode,
  primaryAction: () => Promise<void> | void,
  primaryText: string,
  secondaryAction?: () => Promise<void> | void,
  secondaryText?: string,
  fullPage?: boolean,
}) {
  return (
    <HostedAuthShell fullPage={props.fullPage}>
      <div className="text-center">
        <Typography type="h2" className="mb-2 text-xl font-semibold tracking-tight">{props.title}</Typography>
        <Typography className="text-sm text-muted-foreground">{props.children}</Typography>
      </div>
      <div className="mt-6 flex flex-col gap-2.5">
        <Button onClick={props.primaryAction} className="h-10 rounded-xl font-semibold shadow-sm hover:shadow">
          {props.primaryText}
        </Button>
        {props.secondaryAction != null && props.secondaryText != null && (
          <Button variant="secondary" onClick={props.secondaryAction} className="h-10 rounded-xl font-semibold">
            {props.secondaryText}
          </Button>
        )}
      </div>
    </HostedAuthShell>
  );
}

export function HostedAuthLoading(props: {
  fullPage?: boolean,
}) {
  return (
    <HostedAuthShell fullPage={props.fullPage}>
      <div className="flex min-h-24 items-center justify-center">
        <Spinner size={24} className="text-muted-foreground" />
      </div>
    </HostedAuthShell>
  );
}

export function HostedAuthFallback(props: {
  fullPage?: boolean,
}) {
  const content = (
    <div className="stack-scope flex w-full max-w-[400px] flex-col items-stretch p-4 sm:p-6">
      <div className="mb-6 flex flex-col items-center text-center">
        <div className="hosted-skeleton h-6 w-40 rounded-lg" />
        <div className="hosted-skeleton mt-2 h-3 w-56 rounded-full" />
      </div>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <div className="hosted-skeleton h-3 w-16 rounded-full" />
          <div className="hosted-skeleton h-10 w-full rounded-xl" />
        </div>
        <div className="space-y-1.5">
          <div className="hosted-skeleton h-3 w-24 rounded-full" />
          <div className="hosted-skeleton h-10 w-full rounded-xl" />
        </div>
        <div className="hosted-skeleton h-10 w-full rounded-xl" />
      </div>
    </div>
  );

  if (!props.fullPage) {
    return content;
  }

  return (
    <div
      data-hexclave-handler-page
      className="stack-scope flex min-h-screen w-full items-center justify-center bg-background p-4 sm:p-6"
    >
      {content}
    </div>
  );
}
