'use client';

import { Link } from "@/components/link";
import { ProjectCard } from "@/components/project-card";
import { useRouter } from "@/components/router";
import { SearchBar } from "@/components/search-bar";
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input, Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue, Skeleton, Typography, toast } from "@/components/ui";
import { getPublicEnvVar } from "@/lib/env";
import { hexclaveAppInternalsSymbol } from "@/lib/hexclave-app-internals";
import { FileCode, GearIcon } from "@phosphor-icons/react";
import { AdminOwnedProject, Team, useStackApp, useUser } from "@hexclave/next";
import { isPaidPlan } from "@hexclave/shared/dist/plans";
import { projectOnboardingStatusValues, strictEmailSchema, yupObject, type ProjectOnboardingStatus } from "@hexclave/shared/dist/schema-fields";
import { groupBy } from "@hexclave/shared/dist/utils/arrays";
import { captureError, throwErr } from "@hexclave/shared/dist/utils/errors";
import { runAsynchronously, runAsynchronouslyWithAlert, wait } from "@hexclave/shared/dist/utils/promises";
import { useQueryState } from "@hexclave/shared/dist/utils/react";
import { stringCompare } from "@hexclave/shared/dist/utils/strings";
import { urlString } from "@hexclave/shared/dist/utils/urls";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import * as yup from "yup";
import { inviteUser, listInvitations, revokeInvitation } from "./actions";
import Footer from "./footer";
import PreviewProjectRedirect from "./preview-project-redirect";

type HexclaveAppInternals = {
  sendRequest: (path: string, requestOptions: RequestInit, requestType?: "client" | "server" | "admin") => Promise<Response>,
  refreshOwnedProjects: () => Promise<void>,
};

const PROJECT_ONBOARDING_STATUSES = projectOnboardingStatusValues;

function isStackAppInternals(value: unknown): value is HexclaveAppInternals {
  return (
    value != null &&
    typeof value === "object" &&
    "sendRequest" in value &&
    typeof value.sendRequest === "function" &&
    "refreshOwnedProjects" in value &&
    typeof value.refreshOwnedProjects === "function"
  );
}

function getStackAppInternals(appValue: unknown): HexclaveAppInternals {
  if (appValue == null || typeof appValue !== "object") {
    throw new Error("The Stack app instance is unavailable.");
  }

  const internals = Reflect.get(appValue, hexclaveAppInternalsSymbol);
  if (!isStackAppInternals(internals)) {
    throw new Error("The Stack client app cannot send internal requests.");
  }

  return internals;
}

function isProjectOnboardingStatus(value: unknown): value is ProjectOnboardingStatus {
  return typeof value === "string" && PROJECT_ONBOARDING_STATUSES.some((status) => status === value);
}

export default function PageClient() {
  const isPreview = getPublicEnvVar("NEXT_PUBLIC_STACK_IS_PREVIEW") === "true";
  const isRemoteDevelopmentEnvironment = getPublicEnvVar("NEXT_PUBLIC_STACK_IS_REMOTE_DEVELOPMENT_ENVIRONMENT") === "true";

  return (
    <>
      <DottedBackground />
      {isPreview ? <PreviewProjectRedirect /> : isRemoteDevelopmentEnvironment ? <RdeProjectsListPage /> : <ProjectsListPage />}
      <Footer />
    </>
  );
}

function DottedBackground() {
  return (
    <div
      inert
      style={{
        position: 'absolute',
        inset: 0,
        background: 'radial-gradient(circle, rgba(127, 127, 127, 0.15) 1px, transparent 1px)',
        backgroundSize: '10px 10px',
      }}
    />
  );
}

function RdeProjectsListPage() {
  const user = useUser({
    or: "anonymous-if-exists[deprecated]",
    projectIdMustMatch: "internal",
  }) ?? throwErr("RDE projects page expected a user because useUser was called with an explicit required user mode.");
  const rawProjects = user.useOwnedProjects();
  const [projectConfigPaths, setProjectConfigPaths] = useState<Map<string, string>>(new Map());
  const [loadingConfigPaths, setLoadingConfigPaths] = useState(true);
  const [projectStatuses, setProjectStatuses] = useState<Map<string, ProjectOnboardingStatus>>(new Map());
  const [loadingProjectStatuses, setLoadingProjectStatuses] = useState(true);
  const app = useStackApp();
  const appInternals = useMemo(() => getStackAppInternals(app), [app]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    runAsynchronously(async () => {
      try {
        const response = await fetch("/api/development-environment/projects");
        if (!response.ok) {
          throw new Error(`Failed to load project config paths: ${response.status}`);
        }
        const body = await response.json() as { project_config_paths?: unknown };
        if (body.project_config_paths == null || typeof body.project_config_paths !== "object" || Array.isArray(body.project_config_paths)) {
          throw new Error("Invalid project config paths response.");
        }
        if (!cancelled) {
          const paths = new Map<string, string>();
          for (const [projectId, configPath] of Object.entries(body.project_config_paths)) {
            if (typeof configPath === "string") {
              paths.set(projectId, configPath);
            }
          }
          setProjectConfigPaths(paths);
        }
      } catch (error) {
        captureError("rde-projects-page-load-config-paths", error);
      } finally {
        if (!cancelled) {
          setLoadingConfigPaths(false);
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, [rawProjects.length]);

  useEffect(() => {
    let cancelled = false;
    runAsynchronouslyWithAlert(async () => {
      setLoadingProjectStatuses(true);
      try {
        const response = await appInternals.sendRequest("/internal/projects", {}, "client");
        if (!response.ok) {
          throw new Error(`Failed to load projects: ${response.status} ${await response.text()}`);
        }
        const body = await response.json();
        if (body == null || typeof body !== "object" || !("items" in body) || !Array.isArray(body.items)) {
          throw new Error("Project list endpoint returned an invalid response.");
        }
        const statusMap = new Map<string, ProjectOnboardingStatus>();
        for (const item of body.items) {
          if (item == null || typeof item !== "object" || !("id" in item) || typeof item.id !== "string") {
            continue;
          }
          const onboardingStatus = "onboarding_status" in item ? item.onboarding_status : undefined;
          if (!isProjectOnboardingStatus(onboardingStatus)) {
            throw new Error(`Project ${item.id} returned an invalid onboarding status.`);
          }
          statusMap.set(item.id, onboardingStatus);
        }
        if (!cancelled) {
          setProjectStatuses(statusMap);
        }
      } finally {
        if (!cancelled) {
          setLoadingProjectStatuses(false);
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, [appInternals, rawProjects.length]);

  const sortedProjects = useMemo(() => {
    let projects = [...rawProjects];
    if (search) {
      projects = projects.filter((project) => {
        const configPath = projectConfigPaths.get(project.id);
        const searchTarget = configPath ?? project.id;
        return searchTarget.toLowerCase().includes(search.toLowerCase());
      });
    }
    return projects.sort((a, b) => a.createdAt > b.createdAt ? -1 : 1);
  }, [rawProjects, search, projectConfigPaths]);

  const loading = loadingConfigPaths || loadingProjectStatuses;

  return (
    <div className="flex-grow p-4">
      <div className="mb-5 space-y-2">
        <Typography type="h2" className="text-xl font-semibold tracking-tight">
          Local config files
        </Typography>
        <Typography variant="secondary" className="text-sm">
          You&apos;re running the local Hexclave dashboard. Open any of these config files to manage that local project.
        </Typography>
        <Typography variant="secondary" className="text-sm">
          To open a new config file, run <code>npx @hexclave/cli dev --config-file &lt;config-path&gt; -- &lt;your-dev-command&gt;</code>.
        </Typography>
        <Typography variant="secondary" className="text-sm">
          Once you are ready to go to production, you can link your config file to Hexclave&apos;s <Link className="underline" target="_blank" href="https://app.hexclave.com">cloud dashboard</Link>.
        </Typography>
      </div>

      <div className="mb-4">
        <SearchBar
          placeholder="Search config file path"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-xl" />
          ))}
        </div>
      ) : sortedProjects.length === 0 ? (
        <Typography variant="secondary" className="py-8 text-center">
          {search ? "No projects match your search." : "No projects connected yet. Run `stack dev` to connect a project."}
        </Typography>
      ) : (
        <div className="space-y-1">
          {sortedProjects.map((project) => {
            const configPath = projectConfigPaths.get(project.id);
            const onboardingStatus = projectStatuses.get(project.id);
            const projectHref = onboardingStatus === "completed"
              ? urlString`/projects/${project.id}`
              : urlString`/new-project?project_id=${project.id}`;

            return (
              <Link key={project.id} href={projectHref}>
                <div className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors duration-150 hover:transition-none hover:bg-foreground/[0.04] group">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.06] ring-1 ring-black/[0.04] dark:ring-white/[0.04]">
                    <FileCode className="h-4 w-4 text-muted-foreground" weight="duotone" />
                  </div>
                  <span className="min-w-0 flex-1 truncate font-mono text-sm text-foreground">
                    {configPath ?? project.id}
                  </span>
                  {onboardingStatus != null && onboardingStatus !== "completed" && (
                    <span className="shrink-0 rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-medium text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
                      Setup incomplete
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ProjectsListPage() {
  const app = useStackApp();
  const appInternals = useMemo(() => getStackAppInternals(app), [app]);
  const isRemoteDevelopmentEnvironment = getPublicEnvVar("NEXT_PUBLIC_STACK_IS_REMOTE_DEVELOPMENT_ENVIRONMENT") === "true";
  const user = useUser({
    or: isRemoteDevelopmentEnvironment ? "anonymous-if-exists[deprecated]" : "redirect",
    projectIdMustMatch: "internal",
  }) ?? throwErr("Projects page expected a user because useUser was called with an explicit required user mode.");
  const rawProjects = user.useOwnedProjects();
  const teams = user.useTeams();
  const [sort, setSort] = useState<"recency" | "name">("recency");
  const [search, setSearch] = useState<string>("");
  const [projectStatuses, setProjectStatuses] = useState<Map<string, ProjectOnboardingStatus>>(new Map());
  const [loadingProjectStatuses, setLoadingProjectStatuses] = useState(true);
  const [projectTotalUsers, setProjectTotalUsers] = useState<Map<string, number>>(new Map());
  const [projectDailySignups, setProjectDailySignups] = useState<Map<string, { date: string, activity: number }[]>>(new Map());
  const [loadingProjectMetrics, setLoadingProjectMetrics] = useState(true);
  const [projectMetricsError, setProjectMetricsError] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (rawProjects.length === 0 && !isRemoteDevelopmentEnvironment) {
      router.push('/new-project');
    }
  }, [isRemoteDevelopmentEnvironment, router, rawProjects]);

  useEffect(() => {
    let cancelled = false;
    runAsynchronouslyWithAlert(async () => {
      setLoadingProjectStatuses(true);
      try {
        const response = await appInternals.sendRequest("/internal/projects", {}, "client");
        if (!response.ok) {
          throw new Error(`Failed to load projects: ${response.status} ${await response.text()}`);
        }

        const body = await response.json();
        if (body == null || typeof body !== "object" || !("items" in body) || !Array.isArray(body.items)) {
          throw new Error("Project list endpoint returned an invalid response.");
        }

        const statusMap = new Map<string, ProjectOnboardingStatus>();
        for (const item of body.items) {
          if (item == null || typeof item !== "object" || !("id" in item) || typeof item.id !== "string") {
            continue;
          }

          const onboardingStatus = "onboarding_status" in item ? item.onboarding_status : undefined;
          if (!isProjectOnboardingStatus(onboardingStatus)) {
            throw new Error(`Project ${item.id} returned an invalid onboarding status.`);
          }
          statusMap.set(item.id, onboardingStatus);
        }

        if (!cancelled) {
          setProjectStatuses(statusMap);
        }
      } finally {
        if (!cancelled) {
          setLoadingProjectStatuses(false);
        }
      }
    });

    return () => {
      cancelled = true;
    };
  }, [appInternals, rawProjects.length]);

  useEffect(() => {
    let cancelled = false;
    runAsynchronously(async () => {
      if (!cancelled) {
        setLoadingProjectMetrics(true);
        setProjectMetricsError(false);
      }
      try {
        const response = await appInternals.sendRequest("/internal/projects-metrics", {}, "client");
        if (!response.ok) {
          throw new Error(`Failed to load project metrics: ${response.status} ${await response.text()}`);
        }
        const body = await response.json();
        if (
          body == null ||
          typeof body !== "object" ||
          !("projects" in body) ||
          body.projects == null ||
          typeof body.projects !== "object" ||
          Array.isArray(body.projects)
        ) {
          throw new Error("Failed to load project metrics: response body did not include a projects object.");
        }
        const totalUsersMap = new Map<string, number>();
        const dailySignupsMap = new Map<string, { date: string, activity: number }[]>();
        for (const [projectId, value] of Object.entries(body.projects)) {
          if (value == null || typeof value !== "object") {
            continue;
          }
          const totalUsers = "total_users" in value ? value.total_users : undefined;
          if (typeof totalUsers === "number") {
            totalUsersMap.set(projectId, totalUsers);
          }
          const dailySignups = "daily_signups" in value ? value.daily_signups : undefined;
          if (!Array.isArray(dailySignups)) {
            continue;
          }
          const points: { date: string, activity: number }[] = [];
          for (const point of dailySignups) {
            if (point != null && typeof point === "object" && "date" in point && "activity" in point) {
              const date = point.date;
              const activity = point.activity;
              if (typeof date === "string" && typeof activity === "number") {
                points.push({ date, activity });
              }
            }
          }
          dailySignupsMap.set(projectId, points);
        }

        if (!cancelled) {
          setProjectTotalUsers(totalUsersMap);
          setProjectDailySignups(dailySignupsMap);
        }
      } catch (error) {
        if (cancelled) return;
        setProjectMetricsError(true);
        captureError("projects-page-load-metrics", error);
      } finally {
        if (!cancelled) {
          setLoadingProjectMetrics(false);
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, [appInternals, rawProjects.length]);

  const teamIdMap = useMemo(() => {
    return new Map(teams.map((team) => [team.id, team.displayName]));
  }, [teams]);

  const projectsByTeam = useMemo(() => {
    let newProjects = [...rawProjects];
    if (search) {
      newProjects = newProjects.filter((project) => project.displayName.toLowerCase().includes(search.toLowerCase()));
    }

    const projectSort = (a: AdminOwnedProject, b: AdminOwnedProject) => {
      if (sort === "recency") {
        return a.createdAt > b.createdAt ? -1 : 1;
      } else {
        return stringCompare(a.displayName, b.displayName);
      }
    };

    const grouped = groupBy(newProjects, (project) => project.ownerTeamId);
    return [...grouped.entries()].sort((a, b) => {
      if (a[0] === null) return -1;
      if (b[0] === null) return 1;
      if (sort === "recency") {
        return a[1][0].createdAt > b[1][0].createdAt ? -1 : 1;
      } else {
        return stringCompare(a[1][0].displayName, b[1][0].displayName);
      }
    }).map(([teamId, projects]) => {
      return {
        teamId,
        projects: projects.sort(projectSort),
      };
    });
  }, [rawProjects, sort, search]);

  return (
    <div className="flex-grow p-4">
      <div className="flex justify-between gap-4 mb-4 flex-col sm:flex-row">
        <SearchBar
          placeholder="Search project name"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex gap-4">
          <Select value={sort} onValueChange={(n) => setSort(n === 'recency' ? 'recency' : 'name')}>
            <SelectTrigger>
              <SelectValue>Sort by {sort === "recency" ? "recency" : "name"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="recency">Recency</SelectItem>
                <SelectItem value="name">Name</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>

          {!isRemoteDevelopmentEnvironment && (
            <Button
              className="rounded-xl"
              onClick={async () => {
                router.push("/new-project");
                return await wait(2000);
              }}
            >Create Project
            </Button>
          )}
        </div>
      </div>

      {projectsByTeam.map(({ teamId, projects }) => {
        const team = teamId ? teams.find((t) => t.id === teamId) : undefined;
        return (
          <div key={teamId} className="mb-4">
            <div className="mb-2 flex items-center gap-1">
              <Typography>
                {teamId ? teamIdMap.get(teamId) : "No Team"}
              </Typography>
              {team && (
                <TeamAddUserDialog team={team} />
              )}
            </div>
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 bg">
              {projects.map((project) => {
                const onboardingStatus = projectStatuses.get(project.id);
                if (!loadingProjectStatuses && onboardingStatus == null) {
                  throw new Error(`Missing onboarding status for project ${project.id}.`);
                }
                const projectHref = onboardingStatus === "completed"
                  ? `/projects/${encodeURIComponent(project.id)}`
                  : `/new-project?project_id=${encodeURIComponent(project.id)}`;

                return (
                  <ProjectCard
                    key={project.id}
                    project={project}
                    href={projectHref}
                    showIncompleteBadge={!loadingProjectStatuses && onboardingStatus !== "completed"}
                    totalUsers={projectTotalUsers.get(project.id)}
                    dailySignups={projectDailySignups.get(project.id)}
                    metricsLoading={loadingProjectMetrics}
                    metricsError={projectMetricsError}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const inviteFormSchema = yupObject({
  email: strictEmailSchema("Please enter a valid email address").defined(),
});


function TeamAddUserDialog(props: { team: Team }) {
  const [teamSettingsId, setTeamSettingsId] = useQueryState("team_settings");

  const open = teamSettingsId === props.team.id;
  const setOpen = (isOpen: boolean) => {
    if (isOpen) {
      setTeamSettingsId(props.team.id);
    } else {
      setTeamSettingsId(null);
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Invite teammates to ${props.team.displayName}`}
        title={`Invite teammates to ${props.team.displayName}`}
        onClick={() => setOpen(true)}
      >
        <GearIcon className="h-4 w-4" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Invite a new user to {props.team.displayName}</DialogTitle>
          </DialogHeader>
          <Suspense fallback={<TeamAddUserDialogContentSkeleton />}>
            <TeamAddUserDialogContent
              team={props.team}
              onClose={() => setOpen(false)}
            />
          </Suspense>
        </DialogContent>
      </Dialog>
    </>
  );
}

function TeamAddUserDialogContent(props: {
  team: Team,
  onClose: () => void,
}) {
  const [invitations, setInvitations] = useState<Awaited<ReturnType<typeof listInvitations>>>();
  const [invitationsError, setInvitationsError] = useState<string | null>(null);

  const fetchInvitations = useCallback(async () => {
    setInvitationsError(null);
    try {
      const invitations = await listInvitations(props.team.id);
      setInvitations(invitations);
    } catch (error) {
      setInvitationsError("Failed to load invitations. Please try again.");
    }
  }, [props.team.id]);

  useEffect(() => {
    let canceled = false;
    runAsynchronously(async () => {
      try {
        const invitations = await listInvitations(props.team.id);
        if (!canceled) {
          setInvitations(invitations);
        }
      } catch (error) {
        if (!canceled) {
          setInvitationsError("Failed to load invitations. Please try again.");
        }
      }
    });
    return () => {
      canceled = true;
    };
  }, [props.team.id]);

  const users = props.team.useUsers();
  const admins = props.team.useItem("dashboard_admins");
  const products = props.team.useProducts();
  const hasPaidPlan = isPaidPlan(products);

  const [email, setEmail] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const invitationsLoaded = invitations != null;
  const activeSeats = users.length + (invitations?.length ?? 0);
  const seatLimit = admins.quantity;
  const atCapacity = invitationsLoaded && activeSeats >= seatLimit;

  const handleInvite = async () => {
    if (!invitationsLoaded || atCapacity) {
      return;
    }

    try {
      setFormError(null);
      const values = await inviteFormSchema.validate({ email: email.trim() });
      await inviteUser(props.team.id, values.email, window.location.origin);
      toast({ variant: "success", title: "Team invitation sent" });
      setEmail("");
      await fetchInvitations();
    } catch (error) {
      if (error instanceof yup.ValidationError) {
        setFormError(error.errors[0] ?? error.message);
      } else {
        const message = error instanceof Error ? error.message : "Unknown error";
        toast({ variant: "destructive", title: "Failed to send invitation", description: message });
      }
    }
  };

  const handleAddSeat = async () => {
    const checkoutUrl = await props.team.createCheckoutUrl({
      productId: "extra-seats",
      returnUrl: window.location.href,
    });
    window.location.assign(checkoutUrl);
  };

  const handleUpgrade = async () => {
    const checkoutUrl = await props.team.createCheckoutUrl({
      productId: "team",
      returnUrl: window.location.href,
    });
    window.location.assign(checkoutUrl);
  };

  return (
    <>
      <div className="space-y-4 py-2">
        <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
          <Typography type="label">Dashboard admin seats</Typography>
          {invitationsLoaded ? (
            <Typography variant="secondary">
              {activeSeats}/{seatLimit}
            </Typography>
          ) : (
            <Skeleton className="h-4 w-12" />
          )}
        </div>
        {atCapacity && (
          <Typography variant="secondary" className="text-destructive">
            {hasPaidPlan
              ? "You are at capacity. Add an extra seat for $29/month."
              : "You are at capacity. Upgrade your plan to add more admins."}
          </Typography>
        )}
        <div className="space-y-2">
          <Input
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              if (formError) {
                setFormError(null);
              }
            }}
            placeholder="Email"
            type="email"
            disabled={(!invitationsLoaded && !invitationsError) || atCapacity}
            autoFocus
          />
          {formError && (
            <Typography type="label" className="text-destructive">
              {formError}
            </Typography>
          )}
        </div>

        <div className="space-y-2">
          <Typography type="label">Pending invitations</Typography>
          {invitationsError ? (
            <div className="flex items-center justify-between rounded-md border border-destructive/50 bg-destructive/5 px-3 py-2">
              <Typography variant="secondary" className="text-destructive text-sm">
                {invitationsError}
              </Typography>
              <Button
                variant="ghost"
                size="sm"
                onClick={fetchInvitations}
              >
                Retry
              </Button>
            </div>
          ) : invitations?.length === 0 ? (
            <Typography variant="secondary">None</Typography>
          ) : (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {invitations?.map((invitation) => (
                <div
                  key={invitation.id}
                  className="flex items-center justify-between rounded-md border border-border px-3 py-2"
                >
                  <div className="flex flex-col">
                    <Typography>{invitation.recipientEmail ?? "Pending invitation"}</Typography>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      await revokeInvitation(props.team.id, invitation.id);
                      await fetchInvitations();
                    }}
                  >
                    Revoke
                  </Button>
                </div>
              ))}
              {!invitations && (
                <Skeleton className="h-8 w-full" />
              )}
            </div>
          )}
        </div>
      </div>

      <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
        <Button variant="outline" onClick={props.onClose}>
          Close
        </Button>
        {atCapacity ? (
          hasPaidPlan ? (
            <Button onClick={handleAddSeat} variant="default">
              Add seat ($29/mo)
            </Button>
          ) : (
            <Button onClick={handleUpgrade} variant="default">
              Upgrade plan
            </Button>
          )
        ) : (
          <Button onClick={handleInvite} disabled={!invitationsLoaded && !invitationsError}>
            Invite
          </Button>
        )}
      </DialogFooter>
    </>
  );
}

function TeamAddUserDialogContentSkeleton() {
  return (
    <>
      <div className="space-y-4 py-2">
        <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
          <Typography type="label">Dashboard admin seats</Typography>
          <div className="stack-scope text-md text-zinc-600 dark:text-zinc-400">
            <Skeleton className="h-4 w-16" />
          </div>
        </div>

        <div className="space-y-2">
          <Input
            disabled
            placeholder="Email"
            type="email"
            autoFocus
          />
        </div>

        <div className="space-y-2">
          <Typography type="label">Pending invitations</Typography>
          <Skeleton className="h-8 w-full" />
        </div>
      </div>

      <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
        <Button variant="outline" disabled>
          Close
        </Button>
        <Button disabled>
          Invite
        </Button>
      </DialogFooter>
    </>
  );
}
