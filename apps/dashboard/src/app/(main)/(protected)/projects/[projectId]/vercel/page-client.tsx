"use client";

import { EnvKeys } from "@/components/env-keys";
import { InlineCode } from "@/components/inline-code";
import { StyledLink } from "@/components/link";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Progress,
  Typography,
  cn,
} from "@stackframe/stack-ui";
import { CheckCircle2, Circle } from "lucide-react";
import type { KeyboardEventHandler, MouseEventHandler } from "react";
import { useState } from "react";
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

export default function PageClient() {
  const adminApp = useAdminApp();
  const project = adminApp.useProject();
  const [keys, setKeys] = useState<GeneratedKeys | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manuallyCompleted, setManuallyCompleted] = useState<Partial<Record<StepId, boolean>>>({});

  const handleGenerateKeys = async () => {
    if (isGenerating) return;
    setIsGenerating(true);
    setError(null);

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
        publishableClientKey: newKey.publishableClientKey!,
        secretServerKey: newKey.secretServerKey!,
      });
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to generate API keys. Please try again.");
    } finally {
      setIsGenerating(false);
    }
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

  const steps: Step[] = [
    {
      id: "project",
      title: "Open your Vercel project",
      description: "Make sure the project exists before adding Stack Auth.",
      action: (
        <Button asChild>
          <StyledLink className="flex" href="https://vercel.com/dashboard" target="_blank">
            Go to Vercel
          </StyledLink>
        </Button>
      ),
      completed: isManuallyCompleted("project"),
      canToggle: true,
    },
    {
      id: "keys",
      title: "Generate Stack Auth keys",
      description: "We'll create the environment variable values for you.",
      action: keys ? (
        <div className="space-y-3">
          <EnvKeys
            projectId={keys.projectId}
            publishableClientKey={keys.publishableClientKey}
            secretServerKey={keys.secretServerKey}
          />
          <Typography type="label" variant="secondary">
            Copy everything now—these values only show once.
          </Typography>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <Typography variant="secondary" className="text-sm">
            You’ll receive a publishable client key and a secret server key for this project.
          </Typography>
          <Button onClick={handleGenerateKeys} disabled={isGenerating}>
            {isGenerating ? "Generating..." : "Generate keys"}
          </Button>
          {error && (
            <Alert variant="destructive">
              <AlertTitle>Could not generate keys</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>
      ),
      completed: Boolean(keys) || isManuallyCompleted("keys"),
      canToggle: true,
    },
    {
      id: "env-vars",
      title: "Add environment variables",
      description: "Paste the values into Vercel for each environment you deploy.",
      action: (
        <div className="space-y-2 text-sm text-muted-foreground">
          <Typography variant="secondary" className="text-sm">
            In Vercel → &lt;your-project&gt; → Settings → Environment Variables, copy-paste your environment variables into the input fields.
          </Typography>
        </div>
      ),
      completed: isManuallyCompleted("env-vars"),
      canToggle: true,
    },
    {
      id: "deploy",
      title: "Redeploy on Vercel",
      description: "Trigger a new build so Stack Auth can read the variables.",
      action: (
        <div className="flex flex-col gap-3">
          <Typography variant="secondary" className="text-sm">
            In Vercel → &lt;your-project&gt; → Deployments, redeploy both preview and production projects if they share the same Stack Auth project.
          </Typography>
        </div>
      ),
      completed: isManuallyCompleted("deploy"),
      canToggle: true,
    },
    {
      id: "verify",
      title: "Test your app",
      description: "Open a Stack Auth route to confirm the environment is configured.",
      action: (
        <Typography variant="secondary" className="text-sm">
          Deploy complete? Visit <InlineCode>/handler/signup</InlineCode> on your deployed site to confirm the login flow works.
        </Typography>
      ),
      completed: isManuallyCompleted("verify"),
      canToggle: true,
    },
  ];

  const completedCount = steps.filter((step) => step.completed).length;

  return (
    <AppEnabledGuard appId="vercel">
      <PageLayout
        title="Vercel Integration"
        description="Follow these quick steps to connect Stack Auth with your Vercel project."
      >
        <div className="rounded-xl border border-blue-500/40 bg-blue-500/10 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <Typography className="text-xs font-medium uppercase tracking-wide text-blue-700">
                Vercel setup
              </Typography>
              <Typography className="text-2xl font-semibold text-blue-900">
                {completedCount === steps.length
                  ? "Vercel integration complete!"
                  : `${completedCount}/${steps.length} steps complete`}
              </Typography>
            </div>
            <Badge variant="default" className="bg-blue-600 text-white">
              Vercel Integration
            </Badge>
          </div>
          <Progress
            value={(completedCount / steps.length) * 100}
            className="mt-4 h-2 bg-white/40"
          />
        </div>

        <div className="grid gap-4">
          {steps.map((step, index) => (
            <StepCard
              key={step.id}
              stepNumber={index + 1}
              title={step.title}
              description={step.description}
              completed={step.completed}
              action={step.action}
              canToggle={step.canToggle}
              onToggle={() => toggleStepCompletion(step.id)}
            />
          ))}

          <Card>
            <CardHeader>
              <CardTitle>Need more detail?</CardTitle>
              <CardDescription>See Vercel&apos;s documentation on environment variables for more details.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="secondary">
                <StyledLink href="https://vercel.com/docs/environment-variables" target="_blank">
                  Open Vercel documentation
                </StyledLink>
              </Button>
            </CardContent>
          </Card>
        </div>
      </PageLayout>
    </AppEnabledGuard>
  );
}

type Step = {
  id: StepId,
  title: string,
  description: string,
  action: React.ReactNode,
  completed: boolean,
  canToggle?: boolean,
};

function StepCard(props: {
  stepNumber: number,
  title: string,
  description: string,
  action: React.ReactNode,
  completed: boolean,
  canToggle?: boolean,
  onToggle?: () => void,
}) {
  const isInteractive = Boolean(props.canToggle && props.onToggle);

  const handleClick: MouseEventHandler<HTMLDivElement> = (event) => {
    if (!isInteractive) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("a, button, input, textarea, select")) return;
    props.onToggle?.();
  };

  const handleKeyDown: KeyboardEventHandler<HTMLDivElement> = (event) => {
    if (!isInteractive) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      props.onToggle?.();
    }
  };

  return (
    <Card
      className={cn(
        "overflow-hidden transition-all",
        isInteractive && "cursor-pointer hover:-translate-y-[1px] hover:border-blue-300 hover:shadow-sm",
        props.completed && "border-green-300 bg-green-50/80 dark:border-green-500/40 dark:bg-green-950/30"
      )}
      role={isInteractive ? "button" : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      aria-pressed={isInteractive ? props.completed : undefined}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      <CardHeader className="flex flex-row items-start gap-4 pb-0">
        <div className={cn(
          "flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border text-sm font-semibold",
          props.completed ? "border-green-500 bg-green-500/10 text-green-700" : "border-border text-foreground"
        )}>
          {props.completed ? <CheckCircle2 className="h-5 w-5" /> : <Circle className="h-5 w-5" />}
        </div>
        <div className="flex flex-1 flex-col">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">Step {props.stepNumber} · {props.title}</CardTitle>
              <CardDescription>{props.description}</CardDescription>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-4">{props.action}</CardContent>
    </Card>
  );
}
