"use client";

import { EnvKeys } from "@/components/env-keys";
import { InlineCode } from "@/components/inline-code";
import { StyledLink } from "@/components/link";
import { CaretDownIcon, CaretUpIcon, CheckCircleIcon, CircleIcon, ClockIcon } from "@phosphor-icons/react";
import { runAsynchronously, runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import {
  DesignAlert,
  DesignBadge,
  DesignButton,
  DesignCard,
} from "@/components/design-components";
import {
  cn
} from "@/components/ui";
import * as confetti from "canvas-confetti";
import { useEffect, useRef, useState } from "react";
import { AppEnabledGuard } from "../app-enabled-guard";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";

type GeneratedKeys = {
  projectId: string,
  publishableClientKey: string,
  secretServerKey: string,
};

const STEP_ORDER = ["project", "keys", "env-vars", "deploy", "verify"] as const;
type StepId = typeof STEP_ORDER[number];

const TWO_HUNDRED_YEARS_IN_MS = 1000 * 60 * 60 * 24 * 365 * 200;

type StepStatus = "done" | "action" | "blocked";

const STATUS_META: Record<
  StepStatus,
  {
    cardClass: string,
    inactiveIcon: string,
  }
> = {
  done: {
    cardClass: "border-primary/30 bg-background transition-all duration-300 hover:shadow-lg dark:border-primary/40 dark:shadow-primary/5",
    inactiveIcon: "text-emerald-500 dark:text-emerald-400",
  },
  action: {
    cardClass: "border-primary/30 bg-background transition-all duration-300 hover:shadow-lg dark:border-primary/40 dark:shadow-primary/5",
    inactiveIcon: "text-muted-foreground",
  },
  blocked: {
    cardClass: "border-primary/30 bg-background transition-all duration-300 hover:shadow-lg dark:border-primary/40 dark:shadow-primary/5",
    inactiveIcon: "text-muted-foreground",
  },
};

export default function PageClient() {
  const adminApp = useAdminApp();
  const project = adminApp.useProject();
  const [keys, setKeys] = useState<GeneratedKeys | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manuallyCompleted, setManuallyCompleted] = useState<Partial<Record<StepId, boolean>>>({});
  const [animatedProgress, setAnimatedProgress] = useState(0);
  const [expandedStepId, setExpandedStepId] = useState<StepId | null>(null);
  const prevNextStepIdRef = useRef<StepId | null>(null);
  const prevAllCompletedRef = useRef<boolean | undefined>(undefined);

  const handleGenerateKeys = () => {
    if (isGenerating) return;
    setIsGenerating(true);
    setError(null);

    runAsynchronouslyWithAlert(async () => {
      try {
        const newKey = await adminApp.createInternalApiKey({
          hasPublishableClientKey: true,
          hasSecretServerKey: true,
          hasSuperSecretAdminKey: false,
          expiresAt: new Date(Date.now() + TWO_HUNDRED_YEARS_IN_MS),
          description: "Vercel Integration",
        });

        setKeys({
          projectId: adminApp.projectId,
          publishableClientKey: newKey.publishableClientKey ?? throwErr("Expected publishableClientKey after creating an API key with hasPublishableClientKey: true"),
          secretServerKey: newKey.secretServerKey ?? throwErr("Expected secretServerKey after creating an API key with hasSecretServerKey: true"),
        });
      } finally {
        setIsGenerating(false);
      }
    });
  };

  const toggleStepCompletion = (id: StepId) => {
    setManuallyCompleted((prev) => {
      const index = STEP_ORDER.indexOf(id);
      if (index === -1) return prev;
      const shouldComplete = !prev[id];
      const next: Partial<Record<StepId, boolean>> = { ...prev };

      if (shouldComplete) {
        for (let i = 0; i <= index; i++) {
          next[STEP_ORDER[i]] = true;
        }
      } else {
        for (let i = index; i < STEP_ORDER.length; i++) {
          delete next[STEP_ORDER[i]];
        }
      }

      return next;
    });
  };

  const isManuallyCompleted = (id: StepId) => Boolean(manuallyCompleted[id]);

  const steps: VercelStep[] = [
    {
      id: "project",
      title: "Open your Vercel project",
      subtitle: "Make sure the project exists before adding Stack Auth.",
      status: isManuallyCompleted("project") ? "done" : "action",
      items: [
        {
          id: "vercel-project",
          title: "Vercel project is ready",
          done: isManuallyCompleted("project"),
          detail: (
            <p className="text-xs text-muted-foreground">
              Navigate to your project dashboard on Vercel.
            </p>
          ),
        },
      ],
    },
    {
      id: "keys",
      title: "Generate Stack Auth keys",
      subtitle: "Create environment variable values for your project.",
      status: (Boolean(keys) || isManuallyCompleted("keys")) ? "done" : "action",
      items: [
        {
          id: "generate-keys",
          title: "API keys generated",
          done: Boolean(keys) || isManuallyCompleted("keys"),
          detail: keys ? (
            <div className="space-y-2">
              <EnvKeys
                projectId={keys.projectId}
                publishableClientKey={keys.publishableClientKey}
                secretServerKey={keys.secretServerKey}
              />
              <p className="text-xs text-muted-foreground">
                Copy everything now—these values only show once.
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              You&apos;ll receive a publishable client key and a secret server key for this project.
            </p>
          ),
        },
      ],
    },
    {
      id: "env-vars",
      title: "Add environment variables",
      subtitle: "Paste the values into Vercel for each environment.",
      status: isManuallyCompleted("env-vars") ? "done" : "action",
      items: [
        {
          id: "paste-vars",
          title: "Environment variables configured",
          done: isManuallyCompleted("env-vars"),
          detail: (
            <p className="text-xs text-muted-foreground">
              In Vercel → &lt;your-project&gt; → Settings → Environment Variables, copy-paste your environment variables into the input fields.
            </p>
          ),
        },
      ],
    },
    {
      id: "deploy",
      title: "Redeploy on Vercel",
      subtitle: "Trigger a new build to apply the environment variables.",
      status: isManuallyCompleted("deploy") ? "done" : "action",
      items: [
        {
          id: "redeploy",
          title: "Deployment triggered",
          done: isManuallyCompleted("deploy"),
          detail: (
            <p className="text-xs text-muted-foreground">
              In Vercel → &lt;your-project&gt; → Deployments, redeploy both preview and production projects if they share the same Stack Auth project.
            </p>
          ),
        },
      ],
    },
    {
      id: "verify",
      title: "Test your app",
      subtitle: "Confirm the environment is configured correctly.",
      status: isManuallyCompleted("verify") ? "done" : "action",
      items: [
        {
          id: "test-auth",
          title: "Authentication tested",
          done: isManuallyCompleted("verify"),
          detail: (
            <p className="text-xs text-muted-foreground">
              Visit <InlineCode>/handler/signup</InlineCode> on your deployed site to confirm the login flow works.
            </p>
          ),
        },
      ],
    },
  ];

  const allItems = steps.flatMap((step) =>
    step.items.map((item) => ({ step, item }))
  );
  const completedCount = allItems.filter(({ item }) => item.done).length;
  const nextItem = allItems.find(({ item }) => !item.done) ?? null;

  const vercelProgress = {
    total: allItems.length,
    completed: completedCount,
    next: nextItem,
    value: allItems.length === 0 ? 100 : (completedCount / allItems.length) * 100,
  };

  // Auto-expand the section containing the next step on mount and when next step changes
  useEffect(() => {
    const nextStepId = nextItem?.step.id ?? null;
    const prevNextStepId = prevNextStepIdRef.current;

    if (prevNextStepId === null || (nextStepId !== null && nextStepId !== prevNextStepId)) {
      if (nextStepId !== null) {
        setExpandedStepId(nextStepId);
      } else {
        setExpandedStepId(null);
      }
    }

    prevNextStepIdRef.current = nextStepId;
  }, [nextItem]);

  // Animate progress bar on mount and when progress changes
  useEffect(() => {
    const timer = setTimeout(() => {
      setAnimatedProgress(vercelProgress.value);
    }, 100);
    return () => clearTimeout(timer);
  }, [vercelProgress.value]);

  // Trigger confetti when all tasks are completed
  useEffect(() => {
    const allCompleted = vercelProgress.completed === vercelProgress.total && vercelProgress.total > 0;
    const prevAllCompleted = prevAllCompletedRef.current;

    // Only trigger confetti when completion changes from false to true
    if (prevAllCompleted !== undefined && !prevAllCompleted && allCompleted) {
      // Create a confetti effect dropping from the top
      const duration = 3000;
      const animationEnd = performance.now() + duration;
      const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 9999 };

      function randomInRange(min: number, max: number) {
        return Math.random() * (max - min) + min;
      }

      const interval = setInterval(() => {
        const timeLeft = animationEnd - performance.now();

        if (timeLeft <= 0) {
          clearInterval(interval);
          return;
        }

        const particleCount = 50 * (timeLeft / duration);
        const result = confetti.default({
          ...defaults,
          particleCount,
          origin: { x: randomInRange(0.1, 0.9), y: 0 },
        });
        if (result) {
          runAsynchronously(result, { noErrorLogging: true });
        }
      }, 250);

      // Cleanup interval on unmount or when completion changes
      return () => {
        clearInterval(interval);
      };
    }

    // Update the ref to track the current completion state
    prevAllCompletedRef.current = allCompleted;
  }, [vercelProgress.completed, vercelProgress.total]);

  const handleStepToggle = (stepId: StepId) => {
    setExpandedStepId((current) => (current === stepId ? null : stepId));
  };

  const handleItemClick = (stepId: StepId, itemId: string) => {
    // Toggle the step completion when clicking on an item
    toggleStepCompletion(stepId);
  };

  return (
    <AppEnabledGuard appId="vercel">
      <PageLayout
        title="Vercel Integration"
        description="Follow these quick steps to connect Stack Auth with your Vercel project."
        allowContentOverflow
      >
        <DesignCard
          glassmorphic
          className="group relative overflow-hidden border border-sky-400/40 ring-1 ring-sky-400/20 transition-all duration-300 hover:shadow-md dark:border-sky-500/40 dark:ring-sky-500/30"
          contentClassName="p-7"
        >
          {/* Subtle blue glow on bottom border */}
          <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-sky-400/30 to-transparent blur-[2px] dark:via-sky-500/40" />

          <div className="relative space-y-6">
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-4">
              <h2 className="text-2xl font-semibold tracking-tight text-foreground">
                {vercelProgress.completed === vercelProgress.total
                  ? "Vercel integration complete!"
                  : `${vercelProgress.completed}/${vercelProgress.total} Steps Completed`}
              </h2>
            </div>

            {/* Progress section */}
            <div className="space-y-2">
              <span className="text-xs font-medium text-muted-foreground">
                Progress
              </span>
              <div className="relative">
                <div className="h-2 overflow-hidden rounded-full bg-border/60 dark:bg-border/40">
                  <div
                    className="h-full origin-left rounded-full bg-foreground transition-all duration-700 ease-out"
                    style={{
                      width: `${Math.round(animatedProgress)}%`,
                    }}
                  />
                </div>
              </div>
            </div>

            {/* CTA section */}
            {vercelProgress.next ? (
              <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
                <div className="flex items-center gap-2">
                  <ClockIcon className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    Up next: <span className="font-medium text-foreground">{vercelProgress.next.item.title}</span>
                  </span>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 pt-1">
                <CheckCircleIcon className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                <span className="text-sm text-muted-foreground">
                  All steps complete. Your Vercel integration is ready!
                </span>
              </div>
            )}
          </div>
        </DesignCard>

        <div className="grid gap-4">
          {steps.map((step, index) => {
            const isExpanded = expandedStepId === step.id;
            return (
              <div
                key={step.id}
                className="animate-in fade-in slide-in-from-bottom-4"
                style={{
                  animationDelay: `${Math.min(index * 50, 300)}ms`,
                  animationDuration: "500ms",
                  animationFillMode: "backwards",
                }}
              >
                <StepCard
                  step={step}
                  isExpanded={isExpanded}
                  onToggle={() => handleStepToggle(step.id)}
                  onGenerateKeys={step.id === "keys" && !keys ? handleGenerateKeys : undefined}
                  isGenerating={isGenerating}
                  error={error}
                  onItemClick={(itemId) => handleItemClick(step.id, itemId)}
                />
              </div>
            );
          })}

          <DesignCard
            glassmorphic
            title="Need more detail?"
            subtitle="See Vercel&apos;s documentation on environment variables for more details."
            icon={ClockIcon}
          >
            <DesignButton asChild variant="secondary">
              <StyledLink href="https://vercel.com/docs/environment-variables" target="_blank">
                Open Vercel documentation
              </StyledLink>
            </DesignButton>
          </DesignCard>
        </div>
      </PageLayout>
    </AppEnabledGuard>
  );
}

type VercelSubStep = {
  id: string,
  title: string,
  done: boolean,
  detail?: React.ReactNode,
};

type VercelStep = {
  id: StepId,
  title: string,
  subtitle: string,
  status: StepStatus,
  items: VercelSubStep[],
};

function ChecklistRow(props: {
  status: StepStatus,
  title: string,
  done: boolean,
  detail?: React.ReactNode,
  onClick?: () => void,
}) {
  const Icon = props.done ? CheckCircleIcon : CircleIcon;
  const iconClass = props.done
    ? "text-emerald-500 dark:text-emerald-400"
    : STATUS_META[props.status].inactiveIcon;

  const isClickable = Boolean(props.onClick);

  return (
    <li
      className={cn(
        "group flex items-start gap-3 py-3 transition-all duration-200",
        isClickable && "cursor-pointer hover:bg-accent/50 rounded-lg px-3 -mx-3"
      )}
      onClick={props.onClick}
      onKeyDown={(e) => {
        if (isClickable && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          props.onClick?.();
        }
      }}
      role={isClickable ? "button" : undefined}
      tabIndex={isClickable ? 0 : undefined}
    >
      <Icon className={cn("mt-0.5 h-4 w-4 flex-shrink-0", iconClass)} />
      <div className="space-y-1.5 flex-1">
        <p className="text-sm font-medium leading-snug text-foreground">
          {props.title}
        </p>
        {props.detail}
      </div>
    </li>
  );
}

function StepCard(props: {
  step: VercelStep,
  isExpanded: boolean,
  onToggle: () => void,
  onGenerateKeys?: () => void,
  isGenerating?: boolean,
  error?: string | null,
  onItemClick?: (itemId: string) => void,
}) {
  const meta = STATUS_META[props.step.status];
  const allItemsDone = props.step.items.every((item) => item.done);

  const getActionButton = () => {
    if (props.step.id === "project") {
      return (
        <DesignButton asChild size="sm" className="font-medium border border-border shadow-sm transition-all duration-150 hover:bg-accent active:scale-95 dark:bg-foreground dark:text-background dark:hover:bg-foreground/90">
          <StyledLink href="https://vercel.com/dashboard" target="_blank">
            Go to Vercel
          </StyledLink>
        </DesignButton>
      );
    }
    if (props.step.id === "keys" && props.onGenerateKeys) {
      return (
        <DesignButton
          size="sm"
          onClick={props.onGenerateKeys}
          disabled={props.isGenerating}
          className="font-medium border border-border shadow-sm transition-all duration-150 hover:bg-accent active:scale-95 dark:bg-foreground dark:text-background dark:hover:bg-foreground/90"
        >
          {props.isGenerating ? "Generating..." : "Generate keys"}
        </DesignButton>
      );
    }
    return null;
  };

  return (
    <DesignCard
      glassmorphic
      contentClassName="p-0"
      className={cn(
        "transition-all duration-300",
        meta.cardClass,
        allItemsDone && "border-emerald-500/30 bg-emerald-500/5 dark:border-emerald-500/40 dark:bg-emerald-500/10"
      )}
    >
      <div
        className="cursor-pointer select-none px-6 pt-5"
        onClick={props.onToggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e: { key: string, preventDefault: () => void }) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            props.onToggle();
          }
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1.5 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="text-xl font-semibold">{props.step.title}</h3>
              {allItemsDone && (
                <DesignBadge label="Complete" icon={CheckCircleIcon} color="green" size="sm" />
              )}
            </div>
            <p
              className={cn(
                "text-sm text-muted-foreground transition-opacity duration-300 ease-in-out",
                props.isExpanded ? "opacity-100" : "opacity-0"
              )}
            >
              {props.step.subtitle}
            </p>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              props.onToggle();
            }}
            className="flex shrink-0 items-center justify-center rounded-md p-1.5 transition-colors hover:bg-accent"
            aria-label={props.isExpanded ? "Collapse section" : "Expand section"}
          >
            {props.isExpanded ? (
              <CaretUpIcon className="h-5 w-5 text-muted-foreground" />
            ) : (
              <CaretDownIcon className="h-5 w-5 text-muted-foreground" />
            )}
          </button>
        </div>
      </div>
      <div
        className={cn(
          "grid transition-all duration-300 ease-in-out",
          props.isExpanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        )}
      >
        <div className="overflow-hidden">
          <div className="space-y-4 px-6 pb-4">
            <ul className="divide-y divide-border/40">
              {props.step.items.map((item) => (
                <ChecklistRow
                  key={item.id}
                  status={props.step.status}
                  title={item.title}
                  done={item.done}
                  detail={item.detail}
                  onClick={props.onItemClick ? () => props.onItemClick?.(item.id) : undefined}
                />
              ))}
            </ul>
            {props.error && (
              <DesignAlert
                variant="error"
                title="Could not generate keys"
                description={props.error}
              />
            )}
          </div>
          <div className="flex justify-end px-6 pb-5">
            {getActionButton()}
          </div>
        </div>
      </div>
    </DesignCard>
  );
}
