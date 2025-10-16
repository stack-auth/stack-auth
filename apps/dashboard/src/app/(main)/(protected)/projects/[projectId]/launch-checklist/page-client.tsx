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
  Progress,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Typography,
  cn,
} from "@stackframe/stack-ui";
import { CheckCircle2, Circle } from "lucide-react";
import { useState } from "react";
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
    badgeVariant: React.ComponentProps<typeof Badge>["variant"],
    badgeClass?: string,
    cardClass: string,
    inactiveIcon: string,
  }
> = {
  done: {
    badgeLabel: "Complete",
    badgeVariant: "default",
    badgeClass: "bg-emerald-500 text-white",
    cardClass: "border-emerald-200 bg-emerald-50",
    inactiveIcon: "text-emerald-500",
  },
  action: {
    badgeLabel: "Up next",
    badgeVariant: "outline",
    cardClass: "border-border bg-background",
    inactiveIcon: "text-muted-foreground",
  },
  blocked: {
    badgeLabel: "Resolve",
    badgeVariant: "outline",
    cardClass: "border-border bg-background",
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
    ? "text-emerald-500"
    : STATUS_META[props.status].inactiveIcon;

  return (
    <li className="flex items-start gap-3 rounded-lg border border-border/70 bg-background/80 px-3 py-2">
      <Icon className={cn("mt-1 h-4 w-4 flex-shrink-0", iconClass)} />
      <div className="space-y-1">
        <Typography className="text-sm font-medium leading-none">
          {props.title}
        </Typography>
        {props.detail}
      </div>
    </li>
  );
}

function TaskCard(props: {
  task: LaunchTask,
  children?: React.ReactNode,
  footer?: React.ReactNode,
}) {
  const meta = STATUS_META[props.task.status];

  return (
    <Card className={cn("transition-all", meta.cardClass)}>
      <CardHeader className="flex flex-wrap justify-between gap-3">
        <div className="space-y-1">
          <CardTitle>{props.task.title}</CardTitle>
          <CardDescription>{props.task.subtitle}</CardDescription>
          <Badge variant={meta.badgeVariant} className={meta.badgeClass}>
            {meta.badgeLabel}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="space-y-2">
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
        {props.footer ??
          (props.task.status === "done" ? (
            <Button size="sm" variant="ghost" onClick={props.task.onAction}>
              {props.task.actionLabel}
            </Button>
          ) : (
            <Button size="sm" onClick={props.task.onAction}>
              {props.task.actionLabel}
            </Button>
          ))}
      </CardFooter>
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

  const providerEntries = Array.from(PROVIDER_GUIDES.entries());
  const defaultProviderTab = providerEntries[0]?.[0] ?? "google";

  const oauthChildren =
    sharedOAuthProviders.length > 0 ? (
      <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-3">
        <Typography className="text-xs font-semibold uppercase text-foreground">
          Need new credentials?
        </Typography>
        <Typography variant="secondary" className="text-xs">
          Create an OAuth app with the provider, set Stack as the callback URL,
          then paste the client ID and secret into the provider settings.
        </Typography>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setShowOauthGuides((open) => !open)}
          className="justify-start px-2"
        >
          {showOauthGuides ? "Hide provider guides" : "Show provider guides"}
        </Button>
        {showOauthGuides && (
          <Tabs defaultValue={defaultProviderTab} className="w-full">
            <TabsList className="flex w-full flex-wrap justify-start gap-2">
              {providerEntries.map(([id, guide]) => (
                <TabsTrigger key={id} value={id}>
                  {guide.label}
                </TabsTrigger>
              ))}
            </TabsList>
            {providerEntries.map(([id, guide]) => (
              <TabsContent key={id} value={id} className="space-y-1">
                <Typography>
                  <StyledLink href={guide.docsUrl} target="_blank">
                    {guide.label} setup guide
                  </StyledLink>
                </Typography>
                <Typography variant="secondary" className="text-xs">
                  Callback URL:
                </Typography>
                <InlineCode>{guide.callbackUrl}</InlineCode>
              </TabsContent>
            ))}
          </Tabs>
        )}
      </div>
    ) : undefined;

  const emailChildren = (
    <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-3">
      <Typography className="text-xs font-semibold uppercase text-foreground">
        Quick email setup
      </Typography>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setShowEmailHelp((open) => !open)}
        className="justify-start px-2"
      >
        {showEmailHelp ? "Hide setup steps" : "How do I connect my server?"}
      </Button>
      {showEmailHelp && (
        <ol className="list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
          <li>Verify a sending domain with your email provider.</li>
          <li>
            Switch Stack to Custom SMTP or Resend, then paste the credentials.
          </li>
          <li>Send a test email to confirm delivery.</li>
        </ol>
      )}
    </div>
  );

  const productionChildren = (
    <div className="rounded-lg border border-dashed border-border bg-background p-3">
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
        <Typography variant="secondary" className="text-sm">
          Production mode is live.
        </Typography>
      )}
      <Button
        size="sm"
        variant={productionTaskStatus === "done" ? "ghost" : "secondary"}
        onClick={() => router.push(`${baseProjectPath}/project-settings`)}
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
    <PageLayout
      title="Launch Checklist"
      description="Finish these quick checks before turning on production mode."
    >
      <div className="rounded-xl border border-blue-500/40 bg-blue-500/10 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <Typography className="text-xs font-medium uppercase tracking-wide text-blue-700">
              Launch readiness
            </Typography>
            <Typography className="text-2xl font-semibold text-blue-900">
              {checklistProgress.completed === checklistProgress.total
                ? "Everything is ready to launch."
                : `${checklistProgress.completed}/${checklistProgress.total} checks complete`}
            </Typography>
          </div>
          <Badge variant="default" className="bg-blue-600 text-white">
            Launch Checklist
          </Badge>
        </div>
        <Progress
          value={Math.round(checklistProgress.value)}
          className="mt-4 h-2 bg-white/40"
        />
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          {checklistProgress.next ? (
            <>
              <Typography variant="secondary" className="text-sm text-blue-900">
                Up next: {checklistProgress.next.item.title}
              </Typography>
              <Button
                size="sm"
                onClick={checklistProgress.next.task.onAction}
              >
                Go to {checklistProgress.next.task.title}
              </Button>
            </>
          ) : (
            <Typography variant="secondary" className="text-sm text-blue-900">
              All checks are green. Enable production mode when you are ready.
            </Typography>
          )}
        </div>
      </div>

      <div className="grid gap-4">
        {orderedTasks.map((task) => {
          const extras = taskExtras[task.id] ?? {};
          return (
            <TaskCard
              key={task.id}
              task={task}
              {...extras}
            />
          );
        })}
      </div>
    </PageLayout>
  );
}
