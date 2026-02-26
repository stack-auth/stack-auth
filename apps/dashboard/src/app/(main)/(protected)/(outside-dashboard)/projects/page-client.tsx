'use client';

import { ProjectCard } from "@/components/project-card";
import { useRouter } from "@/components/router";
import { SearchBar } from "@/components/search-bar";
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input, Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue, Skeleton, Typography, toast } from "@/components/ui";
import { getPublicEnvVar } from "@/lib/env";
import { stackAppInternalsSymbol } from "@/lib/stack-app-internals";
import { GearIcon } from "@phosphor-icons/react";
import { AdminOwnedProject, Team, useUser } from "@stackframe/stack";
import { strictEmailSchema, yupObject } from "@stackframe/stack-shared/dist/schema-fields";
import { groupBy } from "@stackframe/stack-shared/dist/utils/arrays";
import { runAsynchronously, wait } from "@stackframe/stack-shared/dist/utils/promises";
import { useQueryState } from "@stackframe/stack-shared/dist/utils/react";
import { stringCompare } from "@stackframe/stack-shared/dist/utils/strings";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import * as yup from "yup";
import { inviteUser, listInvitations, revokeInvitation } from "./actions";

type AdminAppInternals = {
  sendRequest: (path: string, requestOptions: RequestInit, requestType?: "client" | "server" | "admin") => Promise<Response>,
};

function isAdminAppInternals(value: unknown): value is AdminAppInternals {
  return (
    value != null &&
    typeof value === "object" &&
    "sendRequest" in value &&
    typeof value.sendRequest === "function"
  );
}

export default function PageClient() {
  const user = useUser({ or: 'redirect', projectIdMustMatch: "internal" });
  const rawProjects = user.useOwnedProjects();
  const teams = user.useTeams();
  const isLocalEmulator = getPublicEnvVar("NEXT_PUBLIC_STACK_IS_LOCAL_EMULATOR") === "true";
  const [sort, setSort] = useState<"recency" | "name">("recency");
  const [search, setSearch] = useState<string>("");
  const [openConfigFileDialog, setOpenConfigFileDialog] = useState(false);
  const [absoluteConfigFilePath, setAbsoluteConfigFilePath] = useState("");
  const [openingConfigFile, setOpeningConfigFile] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (rawProjects.length === 0 && !isLocalEmulator) {
      router.push('/new-project');
    }
  }, [isLocalEmulator, router, rawProjects]);

  const handleOpenConfigFile = async () => {
    const trimmedPath = absoluteConfigFilePath.trim();
    if (trimmedPath.length === 0) {
      throw new Error("Please enter an absolute config file path.");
    }

    const hasUnixAbsolutePath = trimmedPath.startsWith("/");
    const hasWindowsAbsolutePath = /^[a-zA-Z]:[\\/]/.test(trimmedPath);
    const hasWindowsUncPath = trimmedPath.startsWith("\\\\");
    if (!hasUnixAbsolutePath && !hasWindowsAbsolutePath && !hasWindowsUncPath) {
      throw new Error("Config file path must be absolute.");
    }

    setOpeningConfigFile(true);
    try {
      const internalProject = rawProjects.find((project) => project.id === "internal");
      if (internalProject == null) {
        throw new Error("The internal project client app is not available.");
      }

      const appInternals = Reflect.get(internalProject.app, stackAppInternalsSymbol);
      if (!isAdminAppInternals(appInternals)) {
        throw new Error("The internal project client app cannot send internal requests.");
      }

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
        "admin",
      );
      const responseBody = await response.json().catch(() => null);

      if (!response.ok) {
        if (typeof responseBody === "string" && responseBody.length > 0) {
          throw new Error(responseBody);
        }
        if (
          responseBody != null &&
          typeof responseBody === "object" &&
          "error" in responseBody &&
          typeof responseBody.error === "string" &&
          responseBody.error.length > 0
        ) {
          throw new Error(responseBody.error);
        }
        throw new Error("Failed to open config file project in local emulator.");
      }

      if (
        responseBody == null ||
        typeof responseBody !== "object" ||
        !("project_id" in responseBody) ||
        typeof responseBody.project_id !== "string"
      ) {
        throw new Error("Local emulator endpoint returned an invalid response.");
      }

      setOpenConfigFileDialog(false);
      setAbsoluteConfigFilePath("");
      router.push(`/projects/${encodeURIComponent(responseBody.project_id)}`);
      await wait(2000);
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
          >{isLocalEmulator ? "Open config file" : "Create Project"}
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
            <DialogTitle>Open config file</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Typography variant="secondary">
              Enter the absolute path to your local Stack config file. The local emulator will create or reuse the mapped project and open it in the dashboard.
            </Typography>
            <Input
              autoFocus
              placeholder="/Users/you/project/stack.config.ts"
              value={absoluteConfigFilePath}
              onChange={(event) => setAbsoluteConfigFilePath(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenConfigFileDialog(false)} disabled={openingConfigFile}>
              Cancel
            </Button>
            <Button onClick={handleOpenConfigFile} loading={openingConfigFile}>
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
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
              {projects.map((project) => (
                <ProjectCard key={project.id} project={project} />
              ))}
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

  const fetchInvitations = useCallback(async () => {
    const invitations = await listInvitations(props.team.id);
    setInvitations(invitations);
  }, [props.team.id]);

  useEffect(() => {
    let canceled = false;
    runAsynchronously(async () => {
      const invitations = await listInvitations(props.team.id);
      if (!canceled) {
        setInvitations(invitations);
      }
    });
    return () => {
      canceled = true;
    };
  }, [props.team.id]);

  const users = props.team.useUsers();
  const admins = props.team.useItem("dashboard_admins");

  const [email, setEmail] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const activeSeats = users.length + (invitations?.length ?? 0);
  const seatLimit = admins.quantity;
  const atCapacity = activeSeats >= seatLimit;

  const handleInvite = async () => {
    if (atCapacity) {
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

  const handleUpgrade = async () => {
    try {
      const checkoutUrl = await props.team.createCheckoutUrl({
        productId: "team",
        returnUrl: window.location.href,
      });
      window.location.assign(checkoutUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      toast({ variant: "destructive", title: "Failed to start upgrade", description: message });
    };
  };

  return (
    <>
      <div className="space-y-4 py-2">
        <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
          <Typography type="label">Dashboard admin seats</Typography>
          <Typography variant="secondary">
            {activeSeats}/{seatLimit}
          </Typography>
        </div>
        {atCapacity && (
          <Typography variant="secondary" className="text-destructive">
            You are at capacity. Upgrade your plan to add more admins.
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
            disabled={atCapacity}
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
          {invitations?.length === 0 ? (
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
          <Button onClick={handleUpgrade} variant="default">
            Upgrade plan
          </Button>
        ) : (
          <Button onClick={handleInvite}>
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
