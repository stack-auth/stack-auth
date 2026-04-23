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

function WelcomeIllustration() {
  return (
    <div className="relative h-[280px] w-full sm:h-[320px] md:h-[360px] overflow-hidden">
      {/* Central shield — authentication */}
      <div className={cn(
        "absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2",
        "w-20 h-24 md:w-28 md:h-32 lg:w-32 lg:h-36",
        "rounded-2xl",
        "bg-gradient-to-br from-blue-500/20 via-indigo-500/15 to-violet-500/20",
        "backdrop-blur-xl",
        "ring-1 ring-white/20 dark:ring-white/10",
        "shadow-[0_0_60px_rgba(99,102,241,0.2)]",
        "flex flex-col items-center justify-center gap-1.5 md:gap-2",
      )}>
        <div className="w-7 h-7 md:w-9 md:h-9 lg:w-10 lg:h-10 rounded-full bg-gradient-to-br from-blue-400/40 to-indigo-500/30 ring-1 ring-blue-400/20 flex items-center justify-center">
          <div className="w-3 h-3.5 md:w-4 md:h-4.5 border-2 border-blue-400/60 rounded-sm" />
        </div>
        <div className="space-y-1">
          <div className="h-1 md:h-1.5 bg-white/15 rounded-full w-12 md:w-16 mx-auto" />
          <div className="h-1 md:h-1.5 bg-white/10 rounded-full w-8 md:w-10 mx-auto" />
        </div>
      </div>

      {/* Envelope — emails, top left */}
      <div className={cn(
        "absolute z-20",
        "top-[15%] left-[12%] md:left-[18%] lg:left-[22%]",
        "w-14 h-10 md:w-20 md:h-14 lg:w-24 lg:h-16",
        "rounded-xl",
        "bg-gradient-to-br from-emerald-500/18 to-teal-500/12",
        "ring-1 ring-emerald-500/20",
        "shadow-[0_0_24px_rgba(16,185,129,0.15)]",
        "rotate-[-8deg]",
        "flex items-center justify-center overflow-hidden",
      )}>
        <div className="relative w-full h-full">
          <div className="absolute inset-x-0 top-0 h-[45%] bg-gradient-to-b from-emerald-400/15 to-transparent" style={{ clipPath: "polygon(0 0, 50% 80%, 100% 0)" }} />
          <div className="absolute bottom-1.5 left-1.5 right-1.5 space-y-0.5 md:space-y-1 md:bottom-2 md:left-2.5 md:right-2.5">
            <div className="h-0.5 md:h-1 bg-emerald-500/15 rounded-full w-3/4" />
            <div className="h-0.5 md:h-1 bg-emerald-500/10 rounded-full w-1/2" />
          </div>
        </div>
      </div>

      {/* Credit card — payments, bottom right */}
      <div className={cn(
        "absolute z-20",
        "bottom-[18%] right-[10%] md:right-[16%] lg:right-[20%]",
        "w-16 h-10 md:w-24 md:h-14 lg:w-28 lg:h-16",
        "rounded-xl",
        "bg-gradient-to-br from-violet-500/18 to-purple-500/12",
        "ring-1 ring-violet-500/20",
        "shadow-[0_0_24px_rgba(139,92,246,0.15)]",
        "rotate-[6deg]",
        "flex flex-col justify-between p-2 md:p-3",
      )}>
        <div className="flex justify-between items-start">
          <div className="w-4 h-3 md:w-6 md:h-4 rounded-sm bg-gradient-to-br from-amber-400/50 to-amber-600/30 ring-1 ring-amber-500/20" />
          <div className="flex gap-0.5">
            <div className="w-2.5 h-2.5 md:w-3 md:h-3 rounded-full bg-violet-400/30 -mr-1" />
            <div className="w-2.5 h-2.5 md:w-3 md:h-3 rounded-full bg-purple-400/30" />
          </div>
        </div>
        <div className="h-0.5 md:h-1 bg-white/10 rounded-full w-2/3" />
      </div>

      {/* Bar chart — analytics, top right */}
      <div className={cn(
        "absolute z-10",
        "top-[20%] right-[14%] md:right-[20%] lg:right-[24%]",
        "w-12 h-12 md:w-16 md:h-16 lg:w-20 lg:h-20",
        "rounded-xl",
        "bg-gradient-to-br from-cyan-500/15 to-blue-500/10",
        "ring-1 ring-cyan-500/20",
        "shadow-[0_0_20px_rgba(6,182,212,0.12)]",
        "rotate-[5deg]",
        "flex items-end justify-center gap-0.5 md:gap-1 p-2 md:p-2.5 lg:p-3",
      )}>
        <div className="w-1.5 md:w-2 h-[30%] bg-cyan-400/40 rounded-full" />
        <div className="w-1.5 md:w-2 h-[55%] bg-cyan-400/50 rounded-full" />
        <div className="w-1.5 md:w-2 h-[80%] bg-cyan-400/60 rounded-full" />
        <div className="w-1.5 md:w-2 h-[45%] bg-cyan-400/40 rounded-full" />
      </div>

      {/* People — teams, bottom left */}
      <div className={cn(
        "absolute z-10",
        "bottom-[20%] left-[12%] md:left-[18%] lg:left-[22%]",
        "w-14 h-11 md:w-20 md:h-14 lg:w-24 lg:h-16",
        "rounded-xl",
        "bg-gradient-to-br from-amber-500/15 to-orange-500/10",
        "ring-1 ring-amber-500/18",
        "shadow-[0_0_20px_rgba(245,158,11,0.12)]",
        "rotate-[-4deg]",
        "flex items-center justify-center gap-1 md:gap-1.5",
      )}>
        <div className="flex flex-col items-center">
          <div className="w-2.5 h-2.5 md:w-3.5 md:h-3.5 rounded-full bg-amber-400/40" />
          <div className="w-4 h-2 md:w-5 md:h-2.5 rounded-t-full bg-amber-400/25 mt-0.5" />
        </div>
        <div className="flex flex-col items-center -ml-0.5">
          <div className="w-2.5 h-2.5 md:w-3.5 md:h-3.5 rounded-full bg-orange-400/40" />
          <div className="w-4 h-2 md:w-5 md:h-2.5 rounded-t-full bg-orange-400/25 mt-0.5" />
        </div>
        <div className="flex flex-col items-center -ml-0.5">
          <div className="w-2.5 h-2.5 md:w-3.5 md:h-3.5 rounded-full bg-amber-400/30" />
          <div className="w-4 h-2 md:w-5 md:h-2.5 rounded-t-full bg-amber-400/20 mt-0.5" />
        </div>
      </div>

      {/* Key — API keys, floating small */}
      <div className={cn(
        "absolute z-20",
        "top-[40%] right-[6%] md:right-[10%] lg:right-[14%]",
        "w-8 h-8 md:w-11 md:h-11 lg:w-14 lg:h-14",
        "rounded-lg md:rounded-xl",
        "bg-gradient-to-br from-rose-500/15 to-pink-500/10",
        "ring-1 ring-rose-500/18",
        "shadow-[0_0_16px_rgba(244,63,94,0.1)]",
        "rotate-[15deg]",
        "flex items-center justify-center",
      )}>
        <div className="w-3 h-3 md:w-4 md:h-4 lg:w-5 lg:h-5 rounded-full border-2 border-rose-400/40 relative">
          <div className="absolute left-full top-1/2 -translate-y-1/2 w-1.5 md:w-2 lg:w-2.5 h-0.5 bg-rose-400/30 rounded-full" />
        </div>
      </div>

      {/* Webhook/automation icon — left mid */}
      <div className={cn(
        "absolute z-10 hidden md:flex",
        "top-[48%] left-[6%] lg:left-[12%]",
        "w-10 h-10 lg:w-14 lg:h-14",
        "rounded-xl",
        "bg-gradient-to-br from-sky-500/12 to-indigo-500/8",
        "ring-1 ring-sky-500/15",
        "rotate-[-12deg]",
        "items-center justify-center",
        "opacity-60",
      )}>
        <div className="flex flex-col gap-0.5 lg:gap-1">
          <div className="h-0.5 lg:h-1 w-4 lg:w-6 bg-sky-400/30 rounded-full" />
          <div className="h-0.5 lg:h-1 w-3 lg:w-4 bg-sky-400/20 rounded-full" />
        </div>
      </div>

      {/* Decorative ring — top center */}
      <div className={cn(
        "absolute",
        "top-[6%] left-[42%] md:left-[44%]",
        "w-6 h-6 md:w-8 md:h-8 rounded-full",
        "ring-1 ring-blue-500/15",
        "opacity-40",
      )} />

      {/* Decorative dot — bottom center right */}
      <div className={cn(
        "absolute",
        "bottom-[10%] right-[35%] md:right-[38%]",
        "w-2.5 h-2.5 md:w-3 md:h-3 rounded-full",
        "bg-indigo-500/15",
        "ring-1 ring-indigo-500/10",
      )} />

      {/* Decorative dot — top left */}
      <div className={cn(
        "absolute hidden lg:block",
        "top-[10%] left-[8%]",
        "w-2 h-2 rounded-full",
        "bg-emerald-500/15",
      )} />

      {/* Decorative ring — bottom right */}
      <div className={cn(
        "absolute hidden md:block",
        "bottom-[8%] right-[8%] lg:right-[12%]",
        "w-5 h-5 lg:w-7 lg:h-7 rounded-full",
        "ring-1 ring-purple-500/12",
        "opacity-30",
      )} />

      {/* Decorative dot — right edge */}
      <div className={cn(
        "absolute hidden lg:block",
        "top-[60%] right-[6%]",
        "w-1.5 h-1.5 rounded-full",
        "bg-rose-400/20",
      )} />

      {/* Soft radial glow behind the center */}
      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 md:w-80 md:h-80 rounded-full pointer-events-none"
        style={{ background: "radial-gradient(circle, rgba(99,102,241,0.06) 0%, transparent 70%)" }}
      />
    </div>
  );
}

export type WelcomeSlideProps = {
  steps: TimelineStep[],
  saving: boolean,
  enabledApps: Record<string, { enabled?: boolean } | undefined>,
  onFinish: () => void,
};

export function WelcomeSlide(props: WelcomeSlideProps) {
  const currentIndex = props.steps.findIndex((step) => step.id === "welcome");

  return (
    <div className="flex w-full flex-grow flex-col items-center justify-center px-4 pb-16 pt-8">
      <div
        key="welcome"
        className="flex w-full max-w-xl flex-col items-center"
      >
        <div className="onboarding-cascade w-full" style={{ "--cascade-i": 0 } as CSSProperties}>
          <WelcomeIllustration />
        </div>

        <div className="onboarding-cascade flex flex-col items-center gap-3 text-center" style={{ "--cascade-i": 1 } as CSSProperties}>
          <Typography className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Welcome to Stack Auth
          </Typography>
          <Typography variant="secondary" className="mx-auto max-w-sm text-sm leading-relaxed text-balance">
            Your project is ready. Start building with authentication, emails, payments, and more — all in one place.
          </Typography>
        </div>

        <div className="onboarding-cascade mt-8" style={{ "--cascade-i": 2 } as CSSProperties}>
          <DesignButton
            className="min-w-[200px] rounded-full"
            loading={props.saving}
            onClick={props.onFinish}
          >
            Get Started
          </DesignButton>
        </div>
      </div>

      <div className="onboarding-cascade fixed bottom-6 left-0 right-0 z-50 flex justify-center" style={{ "--cascade-i": 3 } as CSSProperties}>
        <div className="flex items-center gap-[5px]">
          {props.steps.map((step, index) => {
            const isComplete = index < currentIndex;
            const isCurrent = index === currentIndex;

            return (
              <div
                key={step.id}
                aria-label={step.label}
                aria-current={isCurrent ? "step" : undefined}
                className={cn(
                  "rounded-full",
                  isCurrent
                    ? "h-[6px] w-5 bg-foreground"
                    : isComplete
                      ? "h-[6px] w-[6px] bg-foreground/40"
                      : "h-[6px] w-[6px] bg-foreground/20",
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
