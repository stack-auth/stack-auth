"use client";

import { CodeBlock } from "@/components/code-block";
import { DesignPillToggle } from "@/components/design-components";
import { DesignAlert } from "@/components/design-components/alert";
import { DesignButton } from "@/components/design-components/button";
import { DesignCard } from "@/components/design-components/card";
import { CopyButton, SimpleTooltip, Spinner, Typography } from "@/components/ui";
import { getPublicEnvVar } from "@/lib/env";
import { getOnboardingRemindersPrompt } from "@/lib/setup-prompt";
import { cn } from "@/lib/utils";
import { type AdminOwnedProject } from "@hexclave/next";
import { runAsynchronouslyWithAlert, wait } from "@hexclave/shared/dist/utils/promises";
import { EyeIcon, EyeSlashIcon, KeyIcon } from "@phosphor-icons/react";
import { useCallback, useRef, useState, type ReactNode } from "react";

import { OnboardingAiPromptBlock, OnboardingPage } from "./components";
import {
  buildGithubWorkflowAiPrompt,
  buildWorkflowYaml,
  EXAMPLE_WORKFLOW_BRANCH,
  EXAMPLE_WORKFLOW_CONFIG_PATH,
  GITHUB_PROJECT_ID_SECRET_NAME,
  GITHUB_SECRET_SERVER_KEY_SECRET_NAME,
  WORKFLOW_FILE_PATH,
} from "./link-existing-onboarding-workflow";
import type { TimelineStep } from "./shared";

type DeploymentSource = "local" | "github";
type PackageRunner = "npx" | "pnpx" | "bunx";

const PACKAGE_RUNNERS: PackageRunner[] = ["npx", "pnpx", "bunx"];
const DEFAULT_CLI_API_URL = "https://api.hexclave.com";
const DEFAULT_CLI_DASHBOARD_URL = "https://app.hexclave.com";

function normalizeCliUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

function resolveCliApiUrl(): string {
  return normalizeCliUrl(
    getPublicEnvVar("NEXT_PUBLIC_BROWSER_STACK_API_URL")
      ?? getPublicEnvVar("NEXT_PUBLIC_STACK_API_URL")
      ?? DEFAULT_CLI_API_URL,
  );
}

function resolveCliDashboardUrl(): string {
  // Prefer the origin of the dashboard the user is currently on so multi-port
  // local hosts (a/b/c.localhost) match the page they just came from.
  if (typeof window !== "undefined") {
    return normalizeCliUrl(window.location.origin);
  }
  return normalizeCliUrl(
    getPublicEnvVar("NEXT_PUBLIC_BROWSER_STACK_DASHBOARD_URL")
      ?? getPublicEnvVar("NEXT_PUBLIC_STACK_DASHBOARD_URL")
      ?? DEFAULT_CLI_DASHBOARD_URL,
  );
}

/**
 * The CLI reads HEXCLAVE_API_URL / HEXCLAVE_DASHBOARD_URL (or STACK_* aliases).
 * There is no --api-url flag, so non-prod onboarding must prefix env vars into the
 * copy-paste commands — otherwise login/push hit api.hexclave.com by default.
 */
function buildCliCommandEnvPrefix(options?: { includeDashboardUrl?: boolean }): string {
  const apiUrl = resolveCliApiUrl();
  const dashboardUrl = resolveCliDashboardUrl();
  const parts: string[] = [];
  if (apiUrl !== DEFAULT_CLI_API_URL) {
    parts.push(`HEXCLAVE_API_URL=${JSON.stringify(apiUrl)}`);
  }
  if (options?.includeDashboardUrl === true && dashboardUrl !== DEFAULT_CLI_DASHBOARD_URL) {
    parts.push(`HEXCLAVE_DASHBOARD_URL=${JSON.stringify(dashboardUrl)}`);
  }
  return parts.length > 0 ? `${parts.join(" ")} ` : "";
}

type Props = {
  project: AdminOwnedProject,
  steps: TimelineStep[],
  disabled: boolean,
  currentStep: TimelineStep["id"],
  progressIndex?: number,
  progressTotal?: number,
  deploymentSource: DeploymentSource,
  onStepClick: (step: TimelineStep["id"]) => void,
  onBack: () => void,
  onContinueAfterLink: () => Promise<void>,
};

function getApiKeyExpiration(): Date {
  const expiration = new Date();
  expiration.setFullYear(expiration.getFullYear() + 1);
  return expiration;
}

function SecretTableCell(props: {
  children: ReactNode,
  className?: string,
  sensitive?: boolean,
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-2 px-3 py-2.5",
        props.sensitive && "hexclave-sensitive",
        props.className,
      )}
    >
      {props.children}
    </div>
  );
}

function GithubRepositorySecretsTable(props: {
  projectId: string,
  secretServerKey: string,
}) {
  const [secretRevealed, setSecretRevealed] = useState(false);

  return (
    <div className="overflow-hidden rounded-xl ring-1 ring-black/[0.08] dark:ring-white/[0.08]">
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] border-b border-black/[0.06] bg-black/[0.02] text-[11px] font-medium uppercase tracking-wide text-muted-foreground dark:border-white/[0.06] dark:bg-white/[0.03]">
        <SecretTableCell>Name</SecretTableCell>
        <SecretTableCell className="border-l border-black/[0.06] dark:border-white/[0.06]">
          Value
        </SecretTableCell>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] border-b border-black/[0.06] dark:border-white/[0.06]">
        <SecretTableCell>
          <code className="truncate font-mono text-xs">{GITHUB_PROJECT_ID_SECRET_NAME}</code>
          <CopyButton content={GITHUB_PROJECT_ID_SECRET_NAME} variant="ghost" className="shrink-0" />
        </SecretTableCell>
        <SecretTableCell className="border-l border-black/[0.06] dark:border-white/[0.06]">
          <code className="min-w-0 truncate font-mono text-xs">{props.projectId}</code>
          <CopyButton content={props.projectId} variant="ghost" className="shrink-0" />
        </SecretTableCell>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <SecretTableCell>
          <code className="truncate font-mono text-xs">{GITHUB_SECRET_SERVER_KEY_SECRET_NAME}</code>
          <CopyButton content={GITHUB_SECRET_SERVER_KEY_SECRET_NAME} variant="ghost" className="shrink-0" />
        </SecretTableCell>
        <SecretTableCell
          sensitive
          className="border-l border-black/[0.06] dark:border-white/[0.06]"
        >
          <code className="min-w-0 truncate font-mono text-xs">
            {secretRevealed ? props.secretServerKey : "••••••••••••••••••••••••"}
          </code>
          <button
            type="button"
            onClick={() => setSecretRevealed((revealed) => !revealed)}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-foreground/[0.05] hover:text-foreground hover:transition-none"
            title={secretRevealed ? "Hide secret" : "Show secret"}
            aria-label={secretRevealed ? "Hide secret" : "Show secret"}
          >
            {secretRevealed ? <EyeSlashIcon className="h-3.5 w-3.5" /> : <EyeIcon className="h-3.5 w-3.5" />}
          </button>
          <CopyButton content={props.secretServerKey} variant="ghost" className="shrink-0" />
        </SecretTableCell>
      </div>
    </div>
  );
}

export function LinkExistingOnboarding(props: Props) {
  const { onContinueAfterLink, project } = props;
  const [packageRunner, setPackageRunner] = useState<PackageRunner>("npx");
  const [secretServerKey, setSecretServerKey] = useState<string | null>(null);
  const [workflowTab, setWorkflowTab] = useState<"ai-prompt" | "manual">("ai-prompt");
  const [isWaitingForPush, setIsWaitingForPush] = useState(false);
  const pollingRunIdRef = useRef(0);
  const localPollingStartedRef = useRef(false);
  const githubPollingStartedRef = useRef(false);

  const waitForConfigPush = useCallback(async () => {
    const runId = pollingRunIdRef.current + 1;
    pollingRunIdRef.current = runId;
    setIsWaitingForPush(true);
    try {
      while (pollingRunIdRef.current === runId) {
        const source = await project.getPushedConfigSource();
        if (source.type !== "unlinked") {
          await project.getConfig();
          await onContinueAfterLink();
          return;
        }
        await wait(1000);
      }
    } finally {
      if (pollingRunIdRef.current === runId) {
        setIsWaitingForPush(false);
      }
    }
  }, [onContinueAfterLink, project]);

  const handleBack = () => {
    pollingRunIdRef.current += 1;
    props.onBack();
  };

  const generateSecretServerKey = async () => {
    const createdApiKey = await project.app.createInternalApiKey({
      description: "GitHub config sync",
      expiresAt: getApiKeyExpiration(),
      hasPublishableClientKey: false,
      hasSecretServerKey: true,
      hasSuperSecretAdminKey: false,
    });
    if (createdApiKey.secretServerKey == null) {
      throw new Error("Hexclave did not return a secret server key.");
    }
    setSecretServerKey(createdApiKey.secretServerKey);
  };

  const loginCommand = `${buildCliCommandEnvPrefix({ includeDashboardUrl: true })}${packageRunner} @hexclave/cli@latest login`;
  const configPushCommand = `${buildCliCommandEnvPrefix()}${packageRunner} @hexclave/cli@latest config push --cloud-project-id ${JSON.stringify(project.id)} --config-file <path-to-your-config-file>`;

  if (props.deploymentSource === "local") {
    if (!localPollingStartedRef.current) {
      localPollingStartedRef.current = true;
      runAsynchronouslyWithAlert(waitForConfigPush);
    }

    return (
      <OnboardingPage
        stepKey="deploy-local"
        title="Push your config from your computer"
        subtitle="Run these commands from your project directory. This page will continue automatically after the push succeeds."
        steps={props.steps}
        currentStep={props.currentStep}
        progressIndex={props.progressIndex}
        progressTotal={props.progressTotal}
        onStepClick={props.onStepClick}
        onBack={handleBack}
        disabled={props.disabled}
        primaryAction={(
          <SimpleTooltip
            tooltip="Please push the config before proceeding"
            className="w-full"
          >
            <DesignButton className="w-full rounded-full" disabled>
              Awaiting config
            </DesignButton>
          </SimpleTooltip>
        )}
      >
        <div className="space-y-3">
          <DesignCard glassmorphic className="border-0 bg-white/70 dark:bg-background/60" contentClassName="p-4">
            <div className="flex gap-3">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background">1</div>
              <div className="min-w-0 flex-1 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <Typography className="text-sm font-semibold">Sign in to Hexclave</Typography>
                    <Typography variant="secondary" className="text-xs">
                      Authenticate the CLI so it can push config to this project.
                    </Typography>
                  </div>
                  <div className="flex overflow-hidden rounded-lg ring-1 ring-foreground/[0.08]">
                    {PACKAGE_RUNNERS.map((runner) => (
                      <button
                        key={runner}
                        type="button"
                        onClick={() => setPackageRunner(runner)}
                        className={runner === packageRunner
                          ? "bg-foreground px-3 py-1.5 text-xs text-background"
                          : "px-3 py-1.5 text-xs text-muted-foreground transition-colors duration-150 hover:bg-foreground/[0.05] hover:transition-none"}
                      >
                        {runner}
                      </button>
                    ))}
                  </div>
                </div>
                <CodeBlock title="Sign in" icon="terminal" language="bash" content={loginCommand} />
              </div>
            </div>
          </DesignCard>

          <DesignCard glassmorphic className="border-0 bg-white/70 dark:bg-background/60" contentClassName="p-4">
            <div className="flex gap-3">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background">2</div>
              <div className="min-w-0 flex-1 space-y-3">
                <div>
                  <Typography className="text-sm font-semibold">Push your config</Typography>
                  <Typography variant="secondary" className="text-xs">
                    Replace <code>&lt;path-to-your-config-file&gt;</code> with your local config file path.
                  </Typography>
                </div>
                <CodeBlock title="Push config" icon="terminal" language="bash" content={configPushCommand} />
              </div>
            </div>
          </DesignCard>

          {isWaitingForPush && (
            <DesignCard glassmorphic className="border-0 bg-white/70 dark:bg-background/60" contentClassName="p-4">
              <div className="flex items-center gap-2">
                <Spinner size={16} />
                <Typography variant="secondary" className="text-sm">Waiting for the config push…</Typography>
              </div>
            </DesignCard>
          )}
        </div>
      </OnboardingPage>
    );
  }

  if (!githubPollingStartedRef.current) {
    githubPollingStartedRef.current = true;
    runAsynchronouslyWithAlert(waitForConfigPush);
  }

  const exampleWorkflowYaml = buildWorkflowYaml(EXAMPLE_WORKFLOW_BRANCH, EXAMPLE_WORKFLOW_CONFIG_PATH);
  const workflowAiPrompt = buildGithubWorkflowAiPrompt({
    reminders: getOnboardingRemindersPrompt(),
  });

  return (
    <OnboardingPage
      stepKey="deploy-github"
      title="Set up GitHub deployment"
      subtitle="Add a GitHub Actions workflow to deploy your Hexclave project. No GitHub account connection is required."
      steps={props.steps}
      currentStep={props.currentStep}
      progressIndex={props.progressIndex}
      progressTotal={props.progressTotal}
      onStepClick={props.onStepClick}
      onBack={handleBack}
      disabled={props.disabled}
      primaryAction={(
        <SimpleTooltip
          tooltip="Please run the GitHub workflow before proceeding"
          className="w-full"
        >
          <DesignButton className="w-full rounded-full" disabled>
            Awaiting config
          </DesignButton>
        </SimpleTooltip>
      )}
    >
      <div className="space-y-3">
        <DesignCard glassmorphic className="border-0 bg-white/70 dark:bg-background/60" contentClassName="p-4">
          <div className="flex gap-3">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background">1</div>
            <div className="min-w-0 flex-1 space-y-3">
              <div>
                <Typography className="text-sm font-semibold">Set repository secrets</Typography>
                <Typography variant="secondary" className="text-xs">
                  In GitHub, open Settings → Secrets and variables → Actions and add both secrets below.
                </Typography>
              </div>
              {secretServerKey != null ? (
                <div className="space-y-3">
                  <GithubRepositorySecretsTable
                    projectId={project.id}
                    secretServerKey={secretServerKey}
                  />
                  <DesignAlert
                    variant="warning"
                    title="Copy the secret server key now"
                    description="For security, Hexclave cannot show this key again after you leave this page. (However, you can always generate a new one.)"
                  />
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3 rounded-xl bg-black/[0.02] px-4 py-6 text-center dark:bg-white/[0.03]">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-foreground/[0.06] text-foreground">
                    <KeyIcon className="h-5 w-5" />
                  </div>
                  <Typography variant="secondary" className="max-w-sm text-xs leading-relaxed">
                    Generate a project ID and secret server key to paste into your repository secrets.
                  </Typography>
                  <DesignButton variant="secondary" size="sm" onClick={generateSecretServerKey}>
                    Generate Hexclave secrets
                  </DesignButton>
                </div>
              )}
            </div>
          </div>
        </DesignCard>

        <DesignCard glassmorphic className="border-0 bg-white/70 dark:bg-background/60" contentClassName="p-4">
          <div className="flex gap-3">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background">2</div>
            <div className="min-w-0 flex-1 space-y-3">
              <div>
                <Typography className="text-sm font-semibold">Create the workflow file</Typography>
                <Typography variant="secondary" className="text-xs">
                  Add a GitHub Actions workflow that pushes your Hexclave config on every relevant change.
                </Typography>
              </div>

              <div className="flex justify-center">
                <DesignPillToggle
                  options={[
                    { id: "ai-prompt", label: "AI Prompt" },
                    { id: "manual", label: "Manual" },
                  ]}
                  selected={workflowTab}
                  onSelect={(id) => setWorkflowTab(id === "manual" ? "manual" : "ai-prompt")}
                  size="sm"
                  gradient="default"
                />
              </div>

              {workflowTab === "ai-prompt" ? (
                <OnboardingAiPromptBlock title="Workflow prompt" content={workflowAiPrompt} />
              ) : (
                <div className="space-y-3">
                  <Typography variant="secondary" className="text-xs leading-relaxed">
                    Create <code>{WORKFLOW_FILE_PATH}</code> in your repository. The example below uses{" "}
                    <code>{EXAMPLE_WORKFLOW_BRANCH}</code> and <code>{EXAMPLE_WORKFLOW_CONFIG_PATH}</code> —
                    replace those with your real default branch and Hexclave config path before committing.
                  </Typography>
                  <CodeBlock
                    title={WORKFLOW_FILE_PATH}
                    icon="code"
                    language="yaml"
                    content={exampleWorkflowYaml}
                    compact
                    maxHeight={280}
                  />
                </div>
              )}
            </div>
          </div>
        </DesignCard>

        <DesignCard glassmorphic className="border-0 bg-white/70 dark:bg-background/60" contentClassName="p-4">
          <div className="flex gap-3">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background">3</div>
            <div className="min-w-0 flex-1 space-y-1.5">
              <Typography className="text-sm font-semibold">
                {"Run the workflow & make sure it completes successfully"}
              </Typography>
              <Typography variant="secondary" className="text-xs leading-relaxed">
                Usually you just need to push your changes and the workflow will run automatically.
                You can also open the Actions tab in GitHub and run it manually with{" "}
                <code>workflow_dispatch</code>. Confirm the run finishes successfully — this page
                continues once the config push lands.
              </Typography>
            </div>
          </div>
        </DesignCard>

        {isWaitingForPush && (
          <DesignCard glassmorphic className="border-0 bg-white/70 dark:bg-background/60" contentClassName="p-4">
            <div className="flex items-center gap-2">
              <Spinner size={16} />
              <Typography variant="secondary" className="text-sm">
                Waiting for the GitHub workflow to push your config…
              </Typography>
            </div>
          </DesignCard>
        )}
      </div>
    </OnboardingPage>
  );
}
