'use client';

import { InlineCode } from "@/components/inline-code";
import { StyledLink } from "@/components/link";
import { useRouter } from "@/components/router";
import { SettingSwitch } from "@/components/settings";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Typography,
  cn
} from "@stackframe/stack-ui";
import { CheckCircle2, ChevronDown, ChevronUp, Circle, Clock } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AppEnabledGuard } from "../app-enabled-guard";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";

type ProviderGuide = {
  label: string,
  docsUrl: string,
  callbackUrl: string,
};

const PROVIDER_GUIDES: ReadonlyMap<string, ProviderGuide> = new Map([
  [
    "google",
    {
      label: "Google",
      docsUrl:
        "https://developers.google.com/identity/protocols/oauth2#1.-obtain-oauth-2.0-credentials-from-the-dynamic_data.setvar.console_name-.",
      callbackUrl:
        "https://api.stack-auth.com/api/v1/auth/oauth/callback/google",
    },
  ],
  [
    "github",
    {
      label: "GitHub",
      docsUrl:
        "https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app",
      callbackUrl:
        "https://api.stack-auth.com/api/v1/auth/oauth/callback/github",
    },
  ],
  [
    "facebook",
    {
      label: "Facebook",
      docsUrl:
        "https://developers.facebook.com/docs/development/create-an-app/facebook-login-use-case",
      callbackUrl:
        "https://api.stack-auth.com/api/v1/auth/oauth/callback/facebook",
    },
  ],
  [
    "microsoft",
    {
      label: "Microsoft",
      docsUrl:
        "https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app",
      callbackUrl:
        "https://api.stack-auth.com/api/v1/auth/oauth/callback/microsoft",
    },
  ],
  [
    "spotify",
    {
      label: "Spotify",
      docsUrl:
        "https://developer.spotify.com/documentation/general/guides/app-settings/",
      callbackUrl:
        "https://api.stack-auth.com/api/v1/auth/oauth/callback/spotify",
    },
  ],
  [
    "gitlab",
    {
      label: "GitLab",
      docsUrl: "https://docs.gitlab.com/ee/integration/oauth_provider.html",
      callbackUrl:
        "https://api.stack-auth.com/api/v1/auth/oauth/callback/gitlab",
    },
  ],
  [
    "bitbucket",
    {
      label: "Bitbucket",
      docsUrl:
        "https://support.atlassian.com/bitbucket-cloud/docs/use-oauth-on-bitbucket-cloud",
      callbackUrl:
        "https://api.stack-auth.com/api/v1/auth/oauth/callback/bitbucket",
    },
  ],
  [
    "linkedin",
    {
      label: "LinkedIn",
      docsUrl:
        "https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow?context=linkedin%2Fcontext&tabs=HTTPS1",
      callbackUrl:
        "https://api.stack-auth.com/api/v1/auth/oauth/callback/linkedin",
    },
  ],
  [
    "x",
    {
      label: "X",
      docsUrl: "https://developer.x.com/en/docs/apps/overview",
      callbackUrl:
        "https://api.stack-auth.com/api/v1/auth/oauth/callback/x",
    },
  ],
]);

type LaunchTaskStatus = "done" | "action" | "blocked";

type LaunchSubTask = {
  id: string,
  title: string,
  done: boolean,
  detail?: React.ReactNode,
};

type LaunchTask = {
  id: string,
  title: string,
  subtitle: string,
  status: LaunchTaskStatus,
  actionLabel: string,
  onAction: () => void,
  items: LaunchSubTask[],
};

const STATUS_META: Record<
  LaunchTaskStatus,
  {
    badgeLabel: string,
    cardClass: string,
    inactiveIcon: string,
  }
> = {
  done: {
    badgeLabel: "Complete",
    cardClass: "border-primary/30 bg-background transition-all duration-300 hover:shadow-lg dark:border-primary/40 dark:shadow-primary/5",
    inactiveIcon: "text-emerald-500 dark:text-emerald-400",
  },
  action: {
    badgeLabel: "Up next",
    cardClass: "border-primary/30 bg-background transition-all duration-300 hover:shadow-lg dark:border-primary/40 dark:shadow-primary/5",
    inactiveIcon: "text-muted-foreground",
  },
  blocked: {
    badgeLabel: "Resolve",
    cardClass: "border-primary/30 bg-background transition-all duration-300 hover:shadow-lg dark:border-primary/40 dark:shadow-primary/5",
    inactiveIcon: "text-muted-foreground",
  },
};

function ChecklistRow(props: {
  status: LaunchTaskStatus,
  title: string,
  done: boolean,
  detail?: React.ReactNode,
}) {
  const Icon = props.done ? CheckCircle2 : Circle;
  const iconClass = props.done
    ? "text-emerald-500 dark:text-emerald-400"
    : STATUS_META[props.status].inactiveIcon;

  return (
    <li className="group flex items-start gap-3 py-3 transition-all duration-200">
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

function TaskCard(props: {
  task: LaunchTask,
  children?: React.ReactNode,
  footer?: React.ReactNode,
  isExpanded: boolean,
  onToggle: () => void,
}) {
  const meta = STATUS_META[props.task.status];

  return (
    <Card className={cn("transition-all duration-300", meta.cardClass)}>
      <CardHeader
        className="cursor-pointer select-none"
        onClick={props.onToggle}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1.5 flex-1">
            <CardTitle className="text-xl font-semibold">{props.task.title}</CardTitle>
            <CardDescription
              className={cn(
                "text-sm transition-opacity duration-300 ease-in-out",
                props.isExpanded ? "opacity-100" : "opacity-0"
              )}
            >
              {props.task.subtitle}
            </CardDescription>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              props.onToggle();
            }}
            className="flex shrink-0 items-center justify-center rounded-md p-1.5 transition-colors hover:bg-accent"
            aria-label={props.isExpanded ? "Collapse section" : "Expand section"}
          >
            {props.isExpanded ? (
              <ChevronUp className="h-5 w-5 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-5 w-5 text-muted-foreground" />
            )}
          </button>
        </div>
      </CardHeader>
      <div
        className={cn(
          "grid transition-all duration-300 ease-in-out",
          props.isExpanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        )}
      >
        <div className="overflow-hidden">
          <CardContent className="space-y-4">
            <ul className="divide-y divide-border/40">
              {props.task.items.map((item) => (
                <ChecklistRow
                  key={item.id}
                  status={props.task.status}
                  title={item.title}
                  done={item.done}
                  detail={item.detail}
                />
              ))}
            </ul>
            {props.children}
          </CardContent>
          <CardFooter className="flex justify-end">
            {props.footer ?? (
              <Button
                size="sm"
                onClick={props.task.onAction}
                className="font-medium bg-background text-foreground border border-border shadow-sm transition-all duration-150 hover:bg-accent active:scale-95 dark:bg-foreground dark:text-background dark:hover:bg-foreground/90"
              >
                {props.task.actionLabel}
              </Button>
            )}
          </CardFooter>
        </div>
      </div>
    </Card>
  );
}

export default function PageClient() {
  const adminApp = useAdminApp();
  const project = adminApp.useProject();
  const config = project.useConfig();
  const productionModeErrors = project.useProductionModeErrors();
  const router = useRouter();

  const [showOauthGuides, setShowOauthGuides] = useState(false);
  const [showEmailHelp, setShowEmailHelp] = useState(false);
  const [animatedProgress, setAnimatedProgress] = useState(0);

  const domainConfigs = project.config.domains;
  const hasDomainConfigured = domainConfigs.length > 0;
  const isLocalhostAllowed = Boolean(project.config.allowLocalhost);
  const emailServerConfig = config.emails.server;
  const isSharedEmailServer = emailServerConfig.isShared;
  const oauthProviders = project.config.oauthProviders;
  const sharedOAuthProviders = oauthProviders.filter(
    (provider) => provider.type === "shared",
  );
  const baseProjectPath = `/projects/${project.id}`;

  const domainTaskItems: LaunchSubTask[] = [
    {
      id: "domains-added",
      title: "Production domain saved",
      done: hasDomainConfigured,
      detail: hasDomainConfigured ? (
        <div className="flex flex-wrap gap-2">
          {domainConfigs.slice(0, 3).map(({ domain }) => (
            <InlineCode key={domain}>{domain}</InlineCode>
          ))}
          {domainConfigs.length > 3 && (
            <Badge variant="outline">+{domainConfigs.length - 3}</Badge>
          )}
        </div>
      ) : (
        <Typography variant="secondary" className="text-xs">
          Add the HTTPS domain your users return to after signing in.
        </Typography>
      ),
    },
    {
      id: "localhost",
      title: "Localhost callbacks disabled",
      done: !isLocalhostAllowed,
      detail: isLocalhostAllowed ? (
        <Typography variant="secondary" className="text-xs">
          Turn it off so unknown origins can&apos;t capture OAuth responses.
        </Typography>
      ) : null,
    },
  ];

  const domainTask: LaunchTask = {
    id: "domains",
    title: "Domains & callbacks",
    subtitle: "Lock callbacks to trusted production URLs.",
    status: domainTaskItems.every((item) => item.done) ? "done" : "action",
    actionLabel: "Open domain settings",
    onAction: () => router.push(`${baseProjectPath}/domains`),
    items: domainTaskItems,
  };

  const sharedProviderLabels = sharedOAuthProviders.map(
    (provider) => PROVIDER_GUIDES.get(provider.id)?.label ?? provider.id,
  );
  const oauthTask: LaunchTask = {
    id: "oauth",
    title: "OAuth providers",
    subtitle: "Use your own credentials for every provider.",
    status: sharedOAuthProviders.length === 0 ? "done" : "action",
    actionLabel: "Configure providers",
    onAction: () => router.push(`${baseProjectPath}/auth-methods`),
    items: [
      {
        id: "custom-keys",
        title: "Custom client IDs and secrets",
        done: sharedOAuthProviders.length === 0,
        detail:
          sharedOAuthProviders.length === 0 ? (
            <Typography variant="secondary" className="text-xs">
              All providers use your own credentials. You&apos;re good to go.
            </Typography>
          ) : (
            <div className="space-y-2">
              <Typography variant="secondary" className="text-xs">
                Swap custom keys for:
              </Typography>
              <div className="flex flex-wrap gap-2">
                {sharedProviderLabels.map((label) => (
                  <Badge key={label} variant="outline">
                    {label}
                  </Badge>
                ))}
              </div>
            </div>
          ),
      },
    ],
  };

  const emailTask: LaunchTask = {
    id: "email",
    title: "Email server",
    subtitle: "Send messages from your own domain.",
    status: isSharedEmailServer ? "action" : "done",
    actionLabel: "Configure email server",
    onAction: () => router.push(`${baseProjectPath}/emails`),
    items: [
      {
        id: "custom-server",
        title: "Custom SMTP or Resend in use",
        done: !isSharedEmailServer,
        detail: isSharedEmailServer ? (
          <Typography variant="secondary" className="text-xs">
            Switch away from the shared Stack server so customers receive emails
            from your brand.
          </Typography>
        ) : (
          <Typography variant="secondary" className="text-xs">
            Great! Send a quick test email to confirm deliverability.
          </Typography>
        ),
      },
    ],
  };

  const productionChecksPassing = productionModeErrors.length === 0;
  const productionTaskStatus: LaunchTaskStatus = productionChecksPassing
    ? project.isProductionMode
      ? "done"
      : "action"
    : "blocked";
  const productionTask: LaunchTask = {
    id: "production-mode",
    title: "Production mode",
    subtitle: "Lock down development shortcuts once ready.",
    status: productionTaskStatus,
    actionLabel: "Open project settings",
    onAction: () => router.push(`${baseProjectPath}/project-settings`),
    items: [
      {
        id: "checks",
        title: "Automated checks passing",
        done: productionChecksPassing,
        detail:
          productionChecksPassing || productionModeErrors.length === 0 ? (
            <Typography variant="secondary" className="text-xs">
              All checks are passing.
            </Typography>
          ) : (
            <div className="space-y-1">
              <Typography variant="secondary" className="text-xs">
                Fix these before enabling production mode:
              </Typography>
              <ul className="list-disc space-y-1 pl-4 text-xs text-destructive">
                {productionModeErrors.map((error) => (
                  <li key={error.message}>
                    {error.message}{" "}
                    <StyledLink href={error.relativeFixUrl}>
                      open setting
                    </StyledLink>
                  </li>
                ))}
              </ul>
            </div>
          ),
      },
      {
        id: "toggle",
        title: "Production mode enabled",
        done: project.isProductionMode,
        detail: project.isProductionMode ? (
          <Typography variant="secondary" className="text-xs">
            Production mode is on.
          </Typography>
        ) : (
          <Typography variant="secondary" className="text-xs">
            Flip the switch below when everything above is green.
          </Typography>
        ),
      },
    ],
  };

  const tasks: LaunchTask[] = [domainTask, oauthTask, emailTask, productionTask];
  const orderedTasks = [
    ...tasks.filter((task) => task.status !== "done"),
    ...tasks.filter((task) => task.status === "done"),
  ];

  const allItems = tasks.flatMap((task) =>
    task.items.map((item) => ({ task, item })),
  );
  const completed = allItems.filter(({ item }) => item.done).length;
  const next = allItems.find(({ item }) => !item.done) ?? null;
  const checklistProgress = {
    total: allItems.length,
    completed,
    next,
    value: allItems.length === 0 ? 100 : (completed / allItems.length) * 100,
  };

  // Track which section is expanded (only one at a time, excluding "Checks complete")
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const prevNextTaskIdRef = useRef<string | null>(null);

  // Auto-expand the section containing the next task on mount and when next task changes
  useEffect(() => {
    const nextTaskId = next?.task.id ?? null;
    const prevNextTaskId = prevNextTaskIdRef.current;

    // Only auto-expand if:
    // 1. This is the initial load (prevNextTaskId is null), OR
    // 2. The next task actually changed to a different section
    if (prevNextTaskId === null || (nextTaskId !== null && nextTaskId !== prevNextTaskId)) {
      if (nextTaskId !== null) {
        setExpandedTaskId(nextTaskId);
      } else {
        // If all tasks are done, collapse all sections
        setExpandedTaskId(null);
      }
    }

    // Update the ref to track the current next task
    prevNextTaskIdRef.current = nextTaskId;
  }, [next]);

  const handleTaskToggle = (taskId: string) => {
    setExpandedTaskId((current) => (current === taskId ? null : taskId));
  };

  // Animate progress bar on mount and when progress changes
  useEffect(() => {
    const timer = setTimeout(() => {
      setAnimatedProgress(checklistProgress.value);
    }, 100);
    return () => clearTimeout(timer);
  }, [checklistProgress.value]);

  const providerEntries = Array.from(PROVIDER_GUIDES.entries());
  const defaultProviderTab = providerEntries[0]?.[0] ?? "google";

  const oauthChildren =
    sharedOAuthProviders.length > 0 ? (
      <div className="space-y-4 border-t border-border/40 pt-4">
        <div className="flex items-start justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            Need help? View setup guides for each provider.
          </p>
          <button
            onClick={() => setShowOauthGuides((open) => !open)}
            className="flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            {showOauthGuides ? (
              <>
                Hide guides
                <ChevronUp className="h-3 w-3" />
              </>
            ) : (
              <>
                View guides
                <ChevronDown className="h-3 w-3" />
              </>
            )}
          </button>
        </div>
        <div
          className={cn(
            "grid transition-all duration-200 ease-in-out",
            showOauthGuides ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
          )}
        >
          <div className="overflow-hidden">
            <Tabs defaultValue={defaultProviderTab} className="w-full">
              <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 bg-transparent p-0">
                {providerEntries.map(([id, guide]) => (
                  <TabsTrigger
                    key={id}
                    value={id}
                    className="rounded border border-transparent bg-transparent px-2.5 py-1 text-xs data-[state=active]:border-border data-[state=active]:bg-accent"
                  >
                    {guide.label}
                  </TabsTrigger>
                ))}
              </TabsList>
              {providerEntries.map(([id, guide]) => (
                <TabsContent key={id} value={id} className="mt-3 space-y-2.5">
                  <StyledLink href={guide.docsUrl} target="_blank" className="text-sm">
                    View {guide.label} documentation →
                  </StyledLink>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Callback URL</p>
                    <InlineCode>{guide.callbackUrl}</InlineCode>
                  </div>
                </TabsContent>
              ))}
            </Tabs>
          </div>
        </div>
      </div>
    ) : undefined;

  const emailChildren = (
    <div className="space-y-4 border-t border-border/40 pt-4">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          Need help setting up? Follow these steps.
        </p>
        <button
          onClick={() => setShowEmailHelp((open) => !open)}
          className="flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          {showEmailHelp ? (
            <>
              Hide steps
              <ChevronUp className="h-3 w-3" />
            </>
          ) : (
            <>
              View steps
              <ChevronDown className="h-3 w-3" />
            </>
          )}
        </button>
      </div>
      <div
        className={cn(
          "grid transition-all duration-200 ease-in-out",
          showEmailHelp ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        )}
      >
        <div className="overflow-hidden">
          <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
            <li>Verify a sending domain with your email provider.</li>
            <li>
              Switch Stack to Custom SMTP or Resend, then paste the credentials.
            </li>
            <li>Send a test email to confirm delivery.</li>
          </ol>
        </div>
      </div>
    </div>
  );

  const productionChildren = (
    <div className="border-t border-border/40 pt-4">
      <SettingSwitch
        label="Enable production mode"
        checked={project.isProductionMode}
        disabled={
          !project.isProductionMode && productionModeErrors.length > 0
        }
        onCheckedChange={async (checked) => {
          await project.update({ isProductionMode: checked });
        }}
      />
    </div>
  );

  const productionFooter = (
    <div className="flex w-full items-center justify-end gap-3">
      {productionTaskStatus === "done" && (
        <span className="text-sm text-muted-foreground">
          Production mode is live.
        </span>
      )}
      <Button
        size="sm"
        onClick={() => router.push(`${baseProjectPath}/project-settings`)}
        className="font-medium bg-background text-foreground border border-border shadow-sm transition-all duration-150 hover:bg-accent active:scale-95 dark:bg-foreground dark:text-background dark:hover:bg-foreground/90"
      >
        {productionTaskStatus === "done"
          ? "Review settings"
          : "Open project settings"}
      </Button>
    </div>
  );

  const taskExtras: Record<
    LaunchTask["id"],
    { children?: React.ReactNode, footer?: React.ReactNode }
  > = {
    oauth: { children: oauthChildren },
    email: { children: emailChildren },
    "production-mode": { children: productionChildren, footer: productionFooter },
  };

  return (
    <AppEnabledGuard appId="launch-checklist">
      <PageLayout
        title="Launch Checklist"
        description="Finish these quick checks before turning on production mode."
      >
        <div className="group relative overflow-hidden rounded-2xl border border-sky-400/40 bg-gradient-to-br from-card/95 to-card p-7 shadow-sm ring-1 ring-sky-400/20 transition-all duration-300 hover:shadow-md dark:border-sky-500/40 dark:shadow-sm dark:ring-sky-500/30">
          {/* Subtle blue glow on bottom border */}
          <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-sky-400/30 to-transparent blur-[2px] dark:via-sky-500/40" />

          <div className="relative space-y-6">
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-4">
              <h2 className="text-2xl font-semibold tracking-tight text-foreground">
                {checklistProgress.completed === checklistProgress.total
                  ? "Everything is ready to launch."
                  : `${checklistProgress.completed}/${checklistProgress.total} checks complete`}
              </h2>
            </div>

            {/* Progress section - Minimal design */}
            <div className="space-y-2">
              <span className="text-xs font-medium text-muted-foreground">
                Progress
              </span>
              <div className="relative">
                {/* Minimal progress track */}
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
            {checklistProgress.next ? (
              <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    Up next: <span className="font-medium text-foreground">{checklistProgress.next.item.title}</span>
                  </span>
                </div>
                <div className="relative">
                  {/* Rainbow beam effect - outer glow */}
                  <div
                    className="pointer-events-none absolute -inset-[2px] rounded-md opacity-70 blur-sm dark:opacity-60"
                    style={{
                      background: 'linear-gradient(90deg, #3b82f6, #8b5cf6, #ec4899, #f59e0b, #10b981, #3b82f6)',
                      backgroundSize: '200% 100%',
                      animation: 'rainbow-beam 3s ease-in-out infinite',
                    }}
                  />
                  {/* Rainbow beam effect - sharp edge */}
                  <div
                    className="pointer-events-none absolute -inset-[1px] rounded-md opacity-100 dark:opacity-90"
                    style={{
                      background: 'linear-gradient(90deg, #60a5fa, #a78bfa, #f472b6, #fbbf24, #34d399, #60a5fa)',
                      backgroundSize: '200% 100%',
                      animation: 'rainbow-beam 3s ease-in-out infinite',
                    }}
                  />

                  <Button
                    size="sm"
                    onClick={checklistProgress.next.task.onAction}
                    className="relative font-medium shadow-lg transition-all duration-150 hover:shadow-xl active:scale-95"
                  >
                    Go to {checklistProgress.next.task.title}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 pt-1">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                <span className="text-sm text-muted-foreground">
                  All checks complete. Enable production mode when ready.
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="grid gap-4">
          {orderedTasks.map((task, index) => {
            const extras = taskExtras[task.id] ?? {};
            const isExpanded = expandedTaskId === task.id;
            return (
              <div
                key={task.id}
                className="animate-in fade-in slide-in-from-bottom-4"
                style={{
                  animationDelay: `${index * 75}ms`,
                  animationDuration: "500ms",
                  animationFillMode: "backwards",
                }}
              >
                <TaskCard
                  task={task}
                  isExpanded={isExpanded}
                  onToggle={() => handleTaskToggle(task.id)}
                  {...extras}
                />
              </div>
            );
          })}
        </div>
      </PageLayout>
    </AppEnabledGuard>
  );
}
