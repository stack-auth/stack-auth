"use client";

import type { CSSProperties, ReactNode } from "react";

import { AppIcon } from "@/components/app-square";
import { DesignAlert } from "@/components/design-components/alert";
import { DesignBadge } from "@/components/design-components/badge";
import { DesignButton } from "@/components/design-components/button";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Spinner,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  Typography,
  cn,
} from "@/components/ui";
import { CheckCircleIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { AdminOwnedProject } from "@stackframe/stack";
import { ALL_APPS, type AppId } from "@stackframe/stack-shared/dist/apps/apps-config";
import { previewTemplateSource } from "@stackframe/stack-shared/dist/helpers/emails";

import type { TimelineStep } from "./shared";

export type OnboardingPageProps = {
  stepKey: string,
  title: string,
  subtitle?: string,
  steps: TimelineStep[],
  currentStep: TimelineStep["id"],
  onStepClick?: (step: TimelineStep["id"]) => void,
  disabled?: boolean,
  primaryAction: ReactNode,
  secondaryAction?: ReactNode,
  wide?: boolean,
  actionsLayout?: "stacked" | "inline",
  children: ReactNode,
};

export function OnboardingPage(props: OnboardingPageProps) {
  const currentIndex = props.steps.findIndex((step) => step.id === props.currentStep);

  return (
    <div className="flex w-full flex-grow flex-col items-center justify-center px-4 pb-16 pt-8">
      <div
        key={props.stepKey}
        className={cn(
          "flex w-full flex-col items-center gap-8",
          props.wide ? "max-w-5xl" : "max-w-[560px]",
        )}
      >
        <div className="onboarding-cascade space-y-2 text-center" style={{ "--cascade-i": 0 } as CSSProperties}>
          <Typography className="text-3xl font-semibold tracking-tight">
            {props.title}
          </Typography>
          {props.subtitle != null && (
            <Typography variant="secondary" className="mx-auto max-w-md text-sm leading-relaxed">
              {props.subtitle}
            </Typography>
          )}
        </div>

        <div className="onboarding-cascade w-full" style={{ "--cascade-i": 1 } as CSSProperties}>
          {props.children}
        </div>

        <div className="onboarding-cascade" style={{ "--cascade-i": 2 } as CSSProperties}>
          {props.actionsLayout === "inline" ? (
            <div className="flex items-center gap-3">
              {props.primaryAction}
              {props.secondaryAction != null && props.secondaryAction}
            </div>
          ) : (
            <div className="flex w-full max-w-[280px] flex-col items-center gap-3">
              {props.primaryAction}
              {props.secondaryAction != null && (
                <div className="flex justify-center">
                  {props.secondaryAction}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="onboarding-cascade fixed bottom-6 left-0 right-0 z-50 flex justify-center" style={{ "--cascade-i": 3 } as CSSProperties}>
        <div className="flex items-center gap-[5px]">
          {props.steps.map((step, index) => {
            const isComplete = index < currentIndex;
            const isCurrent = index === currentIndex;
            const isClickable = isComplete && !props.disabled && props.onStepClick != null;

            return (
              <button
                key={step.id}
                type="button"
                disabled={!isClickable}
                onClick={() => { if (isClickable) props.onStepClick?.(step.id); }}
                aria-label={isClickable ? `Go to step: ${step.label}` : step.label}
                aria-current={isCurrent ? "step" : undefined}
                className={cn(
                  "rounded-full transition-colors duration-300 hover:transition-none",
                  isCurrent
                    ? "h-[6px] w-5 bg-foreground"
                    : isComplete
                      ? "h-[6px] w-[6px] cursor-pointer bg-foreground/40 hover:bg-foreground/60"
                      : "h-[6px] w-[6px] cursor-default bg-foreground/20",
                )}
                title={step.label}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function appStageBadgeColor(stage: (typeof ALL_APPS)[AppId]["stage"]) {
  if (stage === "alpha") {
    return "orange";
  }
  if (stage === "beta") {
    return "blue";
  }
  return null;
}

export type OnboardingAppCardProps = {
  appId: AppId,
  selected: boolean,
  required: boolean,
  primary: boolean,
  disabled?: boolean,
  onToggle: () => void,
};

export function OnboardingAppCard(props: OnboardingAppCardProps) {
  const app = ALL_APPS[props.appId];
  const stageBadgeColor = appStageBadgeColor(app.stage);

  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={props.required ? undefined : props.onToggle}
          disabled={props.disabled}
          aria-disabled={props.required ? true : undefined}
          tabIndex={props.required ? -1 : undefined}
          className={cn(
            "group flex flex-col items-center gap-1.5 rounded-xl p-1 transition-opacity duration-150 hover:transition-none",
            props.primary ? "w-[100px]" : "w-[90px]",
            props.required ? "cursor-default opacity-100" : props.selected ? "opacity-100" : "opacity-70 hover:opacity-100",
            props.disabled && "pointer-events-none opacity-40",
            !props.required && "active:scale-[0.97]",
          )}
        >
          <div className="relative">
            <AppIcon appId={props.appId} enabled={props.selected} className={props.primary ? "w-20 h-20" : "w-16 h-16"} />
            {props.selected && (
              <div className="absolute -right-1 -top-1 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-white shadow-sm">
                <CheckCircleIcon className="h-4 w-4" weight="fill" />
              </div>
            )}
          </div>
          <Typography className={cn(
            "text-center leading-tight",
            props.primary ? "text-sm font-semibold" : "text-[11px] font-medium",
          )}>
            {app.displayName}
          </Typography>
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        className="z-50 max-w-[240px] rounded-xl border-0 bg-white p-3 shadow-lg ring-1 ring-black/[0.06] dark:bg-background dark:ring-white/[0.06]"
      >
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Typography className="text-sm font-semibold text-foreground">{app.displayName}</Typography>
            {props.required && (
              <DesignBadge label="Required" color="orange" size="sm" />
            )}
            {!props.required && stageBadgeColor != null && (
              <DesignBadge
                label={app.stage === "alpha" ? "Alpha" : "Beta"}
                color={stageBadgeColor}
                size="sm"
              />
            )}
          </div>
          <Typography className="text-xs leading-relaxed text-muted-foreground">
            {app.subtitle}
          </Typography>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

export type DomainSetupTransitionStateProps = {
  advancing: boolean,
  errorMessage: string | null,
  onRetry: () => void,
  onOpenProject: () => void,
};

export function DomainSetupTransitionState(props: DomainSetupTransitionStateProps) {
  if (props.errorMessage == null) {
    return (
      <div className="flex w-full min-h-[320px] items-center justify-center">
        <Spinner size={24} />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col items-center justify-center px-4 py-10">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>We couldn&apos;t continue onboarding</CardTitle>
          <CardDescription>
            Retry the automatic transition to email setup, or open the project and continue from there.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <WarningCircleIcon className="h-4 w-4" />
            <AlertTitle>Domain setup transition failed</AlertTitle>
            <AlertDescription>{props.errorMessage}</AlertDescription>
          </Alert>
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={props.onOpenProject}>
              Open Project
            </Button>
            <Button onClick={props.onRetry} disabled={props.advancing}>
              {props.advancing ? "Retrying..." : "Retry"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function OnboardingEmailThemePreview(props: {
  adminApp: AdminOwnedProject["app"],
  themeId: string,
}) {
  const previewHtml = props.adminApp.useEmailPreview({
    themeId: props.themeId,
    templateTsxSource: previewTemplateSource,
  });

  return (
    <iframe
      srcDoc={previewHtml}
      sandbox=""
      className="pointer-events-none h-full w-full border-0"
      title="Email theme preview"
    />
  );
}

export function ModeNotImplementedCard(props: { onBack: () => void }) {
  return (
    <div className="mx-auto flex min-h-[260px] w-full max-w-2xl flex-col items-center justify-center gap-6 text-center">
      <DesignAlert
        variant="warning"
        title="Not available yet"
        description="Linking an existing config into onboarding is not available yet."
        glassmorphic
      />
      <div className="flex justify-center">
        <DesignButton variant="outline" className="rounded-full px-8" onClick={props.onBack}>
          Go Back
        </DesignButton>
      </div>
    </div>
  );
}
