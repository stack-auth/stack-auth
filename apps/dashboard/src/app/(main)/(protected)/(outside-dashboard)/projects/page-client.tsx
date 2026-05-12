'use client';

import { ProjectCard } from "@/components/project-card";
import { useRouter } from "@/components/router";
import { SearchBar } from "@/components/search-bar";
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input, Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue, Skeleton, Typography, toast } from "@/components/ui";
import { getPublicEnvVar } from "@/lib/env";
import { stackAppInternalsSymbol } from "@/lib/stack-app-internals";
import { GearIcon } from "@phosphor-icons/react";
import { AdminOwnedProject, Team, useStackApp, useUser } from "@stackframe/stack";
import { isPaidPlan } from "@stackframe/stack-shared/dist/plans";
import { projectOnboardingStatusValues, strictEmailSchema, yupObject, type ProjectOnboardingStatus } from "@stackframe/stack-shared/dist/schema-fields";
import { groupBy } from "@stackframe/stack-shared/dist/utils/arrays";
import { runAsynchronously, runAsynchronouslyWithAlert, wait } from "@stackframe/stack-shared/dist/utils/promises";
import { useQueryState } from "@stackframe/stack-shared/dist/utils/react";
import { stringCompare } from "@stackframe/stack-shared/dist/utils/strings";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import * as yup from "yup";
import { inviteUser, listInvitations, revokeInvitation } from "./actions";

type StackAppInternals = {
  sendRequest: (path: string, requestOptions: RequestInit, requestType?: "client" | "server" | "admin") => Promise<Response>,
  refreshOwnedProjects: () => Promise<void>,
};

const PROJECT_ONBOARDING_STATUSES = projectOnboardingStatusValues;

function isStackAppInternals(value: unknown): value is StackAppInternals {
  return (
    value != null &&
    typeof value === "object" &&
    "sendRequest" in value &&
    typeof value.sendRequest === "function" &&
    "refreshOwnedProjects" in value &&
    typeof value.refreshOwnedProjects === "function"
  );
}

function getStackAppInternals(appValue: unknown): StackAppInternals {
  if (appValue == null || typeof appValue !== "object") {
    throw new Error("The Stack app instance is unavailable.");
  }

  const internals = Reflect.get(appValue, stackAppInternalsSymbol);
  if (!isStackAppInternals(internals)) {
    throw new Error("The Stack client app cannot send internal requests.");
  }

  return internals;
}

function isProjectOnboardingStatus(value: unknown): value is ProjectOnboardingStatus {
  return typeof value === "string" && PROJECT_ONBOARDING_STATUSES.some((status) => status === value);
}

export default function PageClient() {
  const app = useStackApp();
  const appInternals = useMemo(() => getStackAppInternals(app), [app]);
  const user = useUser({ or: 'redirect', projectIdMustMatch: "internal" });
  const rawProjects = user.useOwnedProjects();
  const teams = user.useTeams();
  const isLocalEmulator = getPublicEnvVar("NEXT_PUBLIC_STACK_IS_LOCAL_EMULATOR") === "true";
  const isPreview = getPublicEnvVar("NEXT_PUBLIC_STACK_IS_PREVIEW") === "true";
  const [sort, setSort] = useState<"recency" | "name">("recency");
  const [search, setSearch] = useState<string>("");
  const [openConfigFileDialog, setOpenConfigFileDialog] = useState(false);
  const [absoluteConfigFilePath, setAbsoluteConfigFilePath] = useState("");
  const [openingConfigFile, setOpeningConfigFile] = useState(false);
  const [recentConfigProjects, setRecentConfigProjects] = useState<Array<{ project_id: string, absolute_file_path: string, display_name: string }>>([]);
  const [recentConfigProjectsError, setRecentConfigProjectsError] = useState(false);
  const [projectStatuses, setProjectStatuses] = useState<Map<string, ProjectOnboardingStatus>>(new Map());
  const [loadingProjectStatuses, setLoadingProjectStatuses] = useState(true);
  const [projectWeeklyUsers, setProjectWeeklyUsers] = useState<Map<string, number>>(new Map());
  const [projectWeeklyUsersChart, setProjectWeeklyUsersChart] = useState<Map<string, { date: string, activity: number }[]>>(new Map());
  const [loadingProjectWeeklyUsers, setLoadingProjectWeeklyUsers] = useState(true);
  const [projectWeeklyUsersError, setProjectWeeklyUsersError] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (rawProjects.length === 0 && !isLocalEmulator && !isPreview) {
      router.push('/new-project');
    }
  }, [isLocalEmulator, isPreview, router, rawProjects]);

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
    runAsynchronouslyWithAlert(async () => {
      if (!cancelled) {
        setLoadingProjectWeeklyUsers(true);
        setProjectWeeklyUsersError(false);
      }
      try {
        const response = await appInternals.sendRequest("/internal/projects-weekly-users", {}, "client");
        if (!response.ok) {
          throw new Error(`Failed to load project weekly users: ${response.status} ${await response.text()}`);
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
          throw new Error("Failed to load project weekly users: response body did not include a projects object.");
        }
        const weeklyUsersMap = new Map<string, number>();
        const weeklyUsersChartMap = new Map<string, { date: string, activity: number }[]>();
        for (const [projectId, value] of Object.entries(body.projects)) {
          if (value == null || typeof value !== "object") {
            continue;
          }
          const weeklyUsers = "weekly_users" in value ? value.weekly_users : undefined;
          if (typeof weeklyUsers === "number") {
            weeklyUsersMap.set(projectId, weeklyUsers);
          }
          const dailyUsers = "daily_users" in value ? value.daily_users : undefined;
          if (!Array.isArray(dailyUsers)) {
            continue;
          }
          const points: { date: string, activity: number }[] = [];
          for (const point of dailyUsers) {
            if (point != null && typeof point === "object" && "date" in point && "activity" in point) {
              const date = point.date;
              const activity = point.activity;
              if (typeof date === "string" && typeof activity === "number") {
                points.push({ date, activity });
              }
            }
          }
          weeklyUsersChartMap.set(projectId, points);
        }
        if (!cancelled) {
          setProjectWeeklyUsers(weeklyUsersMap);
          setProjectWeeklyUsersChart(weeklyUsersChartMap);
        }
      } catch (error) {
        if (!cancelled) {
          setProjectWeeklyUsersError(true);
        }
        throw error;
      } finally {
        if (!cancelled) {
          setLoadingProjectWeeklyUsers(false);
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, [appInternals, rawProjects.length]);

  useEffect(() => {
    if (!openConfigFileDialog || !isLocalEmulator) return;
    let cancelled = false;
    setRecentConfigProjectsError(false);
    runAsynchronously(async () => {
      try {
        const response = await appInternals.sendRequest("/internal/local-emulator/project", { method: "GET" }, "client");
        if (!response.ok) {
          if (!cancelled) {
            setRecentConfigProjects([]);
            setRecentConfigProjectsError(true);
          }
          return;
        }
        const body = await response.json() as { projects?: unknown };
        if (cancelled) return;
        if (!Array.isArray(body.projects)) {
          throw new Error("Invalid recent-projects payload");
        }
        const parsed = body.projects.map((p: unknown): { project_id: string, absolute_file_path: string, display_name: string } => {
          if (
            !p || typeof p !== "object"
            || typeof (p as Record<string, unknown>).project_id !== "string"
            || typeof (p as Record<string, unknown>).absolute_file_path !== "string"
            || typeof (p as Record<string, unknown>).display_name !== "string"
          ) {
            throw new Error("Invalid recent-projects payload");
          }
          const r = p as Record<string, string>;
          return { project_id: r.project_id, absolute_file_path: r.absolute_file_path, display_name: r.display_name };
        });
        setRecentConfigProjects(parsed);
      } catch {
        if (!cancelled) {
          setRecentConfigProjects([]);
          setRecentConfigProjectsError(true);
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, [openConfigFileDialog, isLocalEmulator, appInternals]);

  const pathCopyTip = useMemo(() => {
    const p = typeof navigator !== "undefined" ? navigator.platform : "";
    if (/Mac|iPhone|iPad|iPod/i.test(p)) {
      return "Tip: in Finder, right-click the file → hold ⌥ Option → Copy as Pathname, then paste here.";
    }
    if (/Win/i.test(p)) {
      return "Note: the emulator runs in a Linux VM and needs a POSIX path. From WSL, run `wslpath -a stack.config.ts` (or `realpath stack.config.ts`) and paste that here.";
    }
    return "Tip: from your project folder, run `realpath stack.config.ts` in a terminal.";
  }, []);

  const handleOpenConfigFile = async () => {
    const trimmedPath = absoluteConfigFilePath.trim();
    if (trimmedPath.length === 0) {
      toast({ description: "Please enter a path to your project or stack.config.ts.", variant: "destructive" });
      return;
    }

    if (!trimmedPath.startsWith("/")) {
      const looksWindows = /^[a-zA-Z]:[\\/]/.test(trimmedPath) || trimmedPath.startsWith("\\\\");
      toast({
        description: looksWindows
          ? "The local emulator runs in a Linux VM and only accepts POSIX paths (e.g. /Users/you/project). Windows paths aren't supported — use WSL or the in-VM path."
          : "The path must be absolute (e.g. /Users/you/project or /Users/you/project/stack.config.ts).",
        variant: "destructive",
      });
      return;
    }

    setOpeningConfigFile(true);
    try {
      const response = await appInternals.sendRequest(
        "/internal/local-emulator/project",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            absolute_file_path: trimmedPath,
          }),
        },
        "client",
      );
      const responseBody = await response.json();

      if (!response.ok) {
        let message = "Couldn't open that path. Make sure it points to your project folder or a valid stack.config.ts.";
        if (typeof responseBody === "string" && responseBody.length > 0) {
          message = responseBody;
        } else if (
          responseBody != null &&
          typeof responseBody === "object" &&
          "error" in responseBody &&
          typeof responseBody.error === "string" &&
          responseBody.error.length > 0
        ) {
          message = responseBody.error;
        }
        toast({ description: message, variant: "destructive" });
        return;
      }

      if (
        responseBody == null ||
        typeof responseBody !== "object" ||
        !("project_id" in responseBody) ||
        typeof responseBody.project_id !== "string"
      ) {
        toast({ description: "Local emulator endpoint returned an invalid response.", variant: "destructive" });
        return;
      }
      const onboardingStatus = "onboarding_status" in responseBody
        ? responseBody.onboarding_status
        : undefined;
      if (!isProjectOnboardingStatus(onboardingStatus)) {
        throw new Error("Local emulator endpoint returned an invalid onboarding status.");
      }

      setOpenConfigFileDialog(false);
      setAbsoluteConfigFilePath("");
      setProjectStatuses((previous) => {
        const next = new Map(previous);
        next.set(responseBody.project_id, onboardingStatus);
        return next;
      });
      await appInternals.refreshOwnedProjects();
      if (onboardingStatus === "completed") {
        router.push(`/projects/${encodeURIComponent(responseBody.project_id)}`);
      } else {
        router.push(`/new-project?project_id=${encodeURIComponent(responseBody.project_id)}`);
      }
      await wait(2000);
    } catch (e) {
      toast({
        description: e instanceof Error ? e.message : "Something went wrong opening that project.",
        variant: "destructive",
      });
    } finally {
      setOpeningConfigFile(false);
    }
  };

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

          <Button
            onClick={async () => {
              if (isLocalEmulator) {
                setOpenConfigFileDialog(true);
                return;
              }
              router.push("/new-project");
              return await wait(2000);
            }}
          >{isLocalEmulator ? "Open a project" : "Create Project"}
          </Button>
        </div>
      </div>

      <Dialog
        open={openConfigFileDialog}
        onOpenChange={(open) => {
          setOpenConfigFileDialog(open);
          if (!open) {
            setAbsoluteConfigFilePath("");
          }
        }}
      >
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Open your Stack Auth project</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Typography variant="secondary">
              Point the local dashboard at the <code>stack.config.ts</code> in your project. If you just ran <code>stack init</code>, it was created at the root of that project.
            </Typography>
            <Typography variant="secondary" className="text-xs">
              Don&apos;t have one yet? Paste your project folder path instead and we&apos;ll create <code>stack.config.ts</code> for you.
            </Typography>
            {recentConfigProjects.length > 0 && (
              <div className="space-y-1">
                <Typography variant="secondary" className="text-xs uppercase tracking-wide">Recent</Typography>
                <div className="max-h-40 overflow-y-auto rounded-md border">
                  {recentConfigProjects.map((p) => (
                    <button
                      key={p.project_id}
                      type="button"
                      className="block w-full truncate px-3 py-2 text-left text-sm hover:bg-muted"
                      onClick={() => setAbsoluteConfigFilePath(p.absolute_file_path)}
                      title={p.absolute_file_path}
                    >
                      {p.absolute_file_path}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {recentConfigProjectsError && recentConfigProjects.length === 0 && (
              <Typography variant="secondary" className="text-xs text-destructive">
                Couldn&apos;t load recent projects. Paste a path below to continue.
              </Typography>
            )}
            <Input
              autoFocus
              placeholder="/Users/you/project/stack.config.ts"
              value={absoluteConfigFilePath}
              onChange={(event) => setAbsoluteConfigFilePath(event.target.value)}
            />
            <Typography variant="secondary" className="text-xs">
              {pathCopyTip}
            </Typography>
          </div>
          <DialogFooter className="pt-2">
            <Button variant="outline" onClick={() => setOpenConfigFileDialog(false)} disabled={openingConfigFile}>
              Cancel
            </Button>
            <Button
              onClick={handleOpenConfigFile}
              loading={openingConfigFile}
              disabled={absoluteConfigFilePath.trim().length === 0}
            >
              Open project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                    weeklyUsers={projectWeeklyUsers.get(project.id)}
                    weeklyUsersChart={projectWeeklyUsersChart.get(project.id)}
                    weeklyUsersLoading={loadingProjectWeeklyUsers}
                    weeklyUsersError={projectWeeklyUsersError}
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
