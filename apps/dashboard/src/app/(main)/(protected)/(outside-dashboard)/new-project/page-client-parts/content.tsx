"use client";

import { DesignButton } from "@/components/design-components/button";
import { DesignInput } from "@/components/design-components/input";
import { DesignSelectorDropdown } from "@/components/design-components/select";
import { useRouter } from "@/components/router";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Spinner,
  Typography,
} from "@/components/ui";
import { getPublicEnvVar } from "@/lib/env";
import { PlusCircleIcon } from "@phosphor-icons/react";
import { AdminOwnedProject, useStackApp, useUser } from "@stackframe/stack";
import { runAsynchronouslyWithAlert, wait } from "@stackframe/stack-shared/dist/utils/promises";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ProjectOnboardingStatus } from "@stackframe/stack-shared/dist/schema-fields";
import { ProjectOnboardingWizard } from "./project-onboarding-wizard";
import {
  beginPendingAction,
  endPendingAction,
  getStackAppInternals,
  isProjectOnboardingState,
  isProjectOnboardingStatus,
  type ProjectOnboardingState,
} from "./shared";

export default function PageClient() {
  const app = useStackApp();
  const appInternals = useMemo(() => getStackAppInternals(app), [app]);
  const user = useUser({ or: "redirect", projectIdMustMatch: "internal" });
  const teams = user.useTeams();
  const projects = user.useOwnedProjects();
  const router = useRouter();
  const searchParams = useSearchParams();
  const isLocalEmulator = getPublicEnvVar("NEXT_PUBLIC_STACK_IS_LOCAL_EMULATOR") === "true";

  const selectedProjectId = searchParams.get("project_id");
  const displayNameFromSearch = searchParams.get("display_name");
  const redirectToNeonConfirmWith = searchParams.get("redirect_to_neon_confirm_with");
  const redirectToConfirmWith = searchParams.get("redirect_to_confirm_with");
  const mode = searchParams.get("mode");

  const [projectStatuses, setProjectStatuses] = useState<Map<string, ProjectOnboardingStatus>>(new Map());
  const [projectOnboardingStates, setProjectOnboardingStates] = useState<Map<string, ProjectOnboardingState | null>>(new Map());
  const [loadingStatuses, setLoadingStatuses] = useState(true);
  const [projectName, setProjectName] = useState(displayNameFromSearch ?? "");
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [creatingTeam, setCreatingTeam] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [isCreateProjectOpen, setIsCreateProjectOpen] = useState(true);
  const [isCreateTeamOpen, setIsCreateTeamOpen] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");
  const creatingTeamRef = useRef(false);
  const creatingProjectRef = useRef(false);

  useEffect(() => {
    if (selectedTeamId != null) {
      return;
    }

    if (user.selectedTeam != null) {
      setSelectedTeamId(user.selectedTeam.id);
      return;
    }

    const firstTeam = teams.at(0);
    if (firstTeam !== undefined) {
      setSelectedTeamId(firstTeam.id);
    }
  }, [selectedTeamId, teams, user.selectedTeam]);

  const updateSearchParams = useCallback((updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());

    for (const [key, value] of Object.entries(updates)) {
      if (value == null || value.length === 0) {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    }

    const query = params.toString();
    router.replace(query.length > 0 ? `/new-project?${query}` : "/new-project");
  }, [router, searchParams]);

  useEffect(() => {
    let cancelled = false;

    runAsynchronouslyWithAlert(async () => {
      setLoadingStatuses(true);
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
        const onboardingStateMap = new Map<string, ProjectOnboardingState | null>();
        for (const item of body.items) {
          if (item == null || typeof item !== "object" || !("id" in item) || typeof item.id !== "string") {
            continue;
          }

          const onboardingStatus = "onboarding_status" in item ? item.onboarding_status : undefined;
          if (!isProjectOnboardingStatus(onboardingStatus)) {
            throw new Error(`Project ${item.id} returned an invalid onboarding status.`);
          }
          statusMap.set(item.id, onboardingStatus);

          const onboardingState = "onboarding_state" in item ? item.onboarding_state : null;
          if (onboardingState != null && !isProjectOnboardingState(onboardingState)) {
            throw new Error(`Project ${item.id} returned an invalid onboarding state.`);
          }
          onboardingStateMap.set(item.id, onboardingState);
        }

        if (!cancelled) {
          setProjectStatuses(statusMap);
          setProjectOnboardingStates(onboardingStateMap);
        }
      } finally {
        if (!cancelled) {
          setLoadingStatuses(false);
        }
      }
    });

    return () => {
      cancelled = true;
    };
  }, [appInternals, projects.length]);

  const selectedProject = useMemo(() => {
    if (selectedProjectId == null) {
      return null;
    }
    return projects.find((project) => project.id === selectedProjectId) ?? null;
  }, [projects, selectedProjectId]);

  const selectedProjectStatus = useMemo(() => {
    if (selectedProjectId == null) {
      return null;
    }
    return projectStatuses.get(selectedProjectId) ?? null;
  }, [projectStatuses, selectedProjectId]);

  const selectedProjectOnboardingState = useMemo(() => {
    if (selectedProjectId == null) {
      return null;
    }
    return projectOnboardingStates.get(selectedProjectId) ?? null;
  }, [projectOnboardingStates, selectedProjectId]);

  useEffect(() => {
    if (selectedProject == null || loadingStatuses || selectedProjectStatus !== "completed") {
      return;
    }

    router.replace(`/projects/${encodeURIComponent(selectedProject.id)}`);
  }, [loadingStatuses, router, selectedProject, selectedProjectStatus]);

  const setSelectedProjectStatus = async (project: AdminOwnedProject, status: ProjectOnboardingStatus) => {
    const projectInternals = getStackAppInternals(project.app);

    const response = await projectInternals.sendRequest(
      "/internal/projects/current",
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ onboarding_status: status }),
      },
      "admin",
    );

    if (!response.ok) {
      throw new Error(`Failed to update onboarding status: ${response.status} ${await response.text()}`);
    }

    setProjectStatuses((previous) => {
      const next = new Map(previous);
      next.set(project.id, status);
      return next;
    });

    await appInternals.refreshOwnedProjects();
  };

  const setSelectedProjectOnboardingState = async (project: AdminOwnedProject, onboardingState: ProjectOnboardingState | null) => {
    const projectInternals = getStackAppInternals(project.app);

    const response = await projectInternals.sendRequest(
      "/internal/projects/current",
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ onboarding_state: onboardingState }),
      },
      "admin",
    );

    if (!response.ok) {
      throw new Error(`Failed to update onboarding state: ${response.status} ${await response.text()}`);
    }

    setProjectOnboardingStates((previous) => {
      const next = new Map(previous);
      next.set(project.id, onboardingState);
      return next;
    });
  };

  if (isLocalEmulator && selectedProjectId == null) {
    return (
      <div className="w-full flex-grow flex items-center justify-center p-4">
        <div className="max-w-lg w-full rounded-lg border border-border p-6 space-y-4">
          <Typography type="h2">Project creation is disabled in local emulator mode</Typography>
          <Typography variant="secondary">
            Use the <b>Open config file</b> action on the Projects page to open or create projects from a local config file path.
          </Typography>
          <div className="flex justify-end">
            <Button onClick={async () => {
              router.push("/projects");
              await wait(2000);
            }}>
              Go to Projects
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (loadingStatuses && selectedProjectId != null) {
    return (
      <div className="flex w-full flex-grow items-center justify-center">
        <Spinner size={24} />
      </div>
    );
  }

  if (selectedProjectId != null && selectedProject == null) {
    return (
      <div className="w-full flex-grow flex items-center justify-center p-4">
        <Card className="w-full max-w-xl">
          <CardHeader>
            <CardTitle>Project not found</CardTitle>
            <CardDescription>We could not find the project in your account.</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-end">
            <Button variant="outline" onClick={() => router.push("/projects")}>Go to Projects</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (selectedProject != null && !loadingStatuses && selectedProjectStatus === "completed") {
    return (
      <div className="flex w-full flex-grow items-center justify-center">
        <Spinner size={24} />
      </div>
    );
  }

  if (selectedProject != null && !loadingStatuses && selectedProjectStatus == null) {
    throw new Error(`Missing onboarding status for project ${selectedProject.id}.`);
  }

  if (selectedProject == null) {
    return (
      <div className="flex w-full flex-grow items-center justify-center">
        <Dialog
          open={isCreateProjectOpen}
          onOpenChange={(open) => {
            setIsCreateProjectOpen(open);
            if (!open) {
              router.push("/projects");
            }
          }}
        >
          <DialogContent
            className="overflow-hidden border-0 bg-white/90 p-0 shadow-2xl backdrop-blur-xl ring-1 ring-black/[0.06] dark:bg-background/75 dark:ring-white/[0.08] sm:max-w-[720px] sm:rounded-3xl"
            overlayProps={{ className: "bg-black/70 backdrop-blur-[2px]" }}
            noCloseButton
          >
            <DialogHeader className="border-b border-black/[0.08] px-6 py-6 text-left dark:border-white/[0.08]">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-blue-500/10 p-2.5 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400">
                  <PlusCircleIcon className="h-5 w-5" />
                </div>
                <div className="space-y-1">
                  <DialogTitle className="text-xl font-semibold tracking-tight">Create a new project</DialogTitle>
                </div>
              </div>
              <DialogDescription>
                Start by naming your project and choosing the team that will own it.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-5 px-6 py-6">
              <div className="space-y-2">
                <Label htmlFor="project-name">Project name</Label>
                <DesignInput
                  id="project-name"
                  value={projectName}
                  onChange={(event) => setProjectName(event.target.value)}
                  placeholder="My Project"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="team-id">Team</Label>
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <DesignSelectorDropdown
                    value={selectedTeamId ?? ""}
                    onValueChange={setSelectedTeamId}
                    placeholder="Select a team"
                    size="md"
                    className="w-full"
                    options={teams.map((team) => ({ value: team.id, label: team.displayName }))}
                  />
                  <DesignButton variant="outline" onClick={() => setIsCreateTeamOpen(true)} className="rounded-xl sm:min-w-[152px]">
                    <PlusCircleIcon className="mr-2 h-4 w-4" />
                    Create Team
                  </DesignButton>
                </div>
              </div>
            </div>

            <DialogFooter className="border-t border-black/[0.08] px-6 py-4 dark:border-white/[0.08] sm:justify-end sm:space-x-2">
              <DesignButton variant="outline" className="rounded-xl" onClick={() => router.push("/projects")} disabled={creatingProject}>
                Cancel
              </DesignButton>
              <DesignButton
                className="rounded-xl"
                loading={creatingProject}
                onClick={() => {
                  if (!beginPendingAction(creatingProjectRef, setCreatingProject)) {
                    return;
                  }

                  return runAsynchronouslyWithAlert(async () => {
                    const trimmedProjectName = projectName.trim();
                    if (trimmedProjectName.length === 0) {
                      throw new Error("Project name is required.");
                    }

                    const firstTeam = teams.at(0);
                    const teamId = selectedTeamId ?? user.selectedTeam?.id ?? firstTeam?.id;
                    if (teamId === undefined) {
                      throw new Error("Select a team before creating the project.");
                    }

                    try {
                      const newProject = await user.createProject({
                        displayName: trimmedProjectName,
                        teamId,
                        onboardingStatus: "config_choice",
                      });

                      setProjectStatuses((previous) => {
                        const next = new Map(previous);
                        next.set(newProject.id, "config_choice");
                        return next;
                      });
                      setProjectOnboardingStates((previous) => {
                        const next = new Map(previous);
                        next.set(newProject.id, null);
                        return next;
                      });

                      if (redirectToNeonConfirmWith != null) {
                        const confirmSearchParams = new URLSearchParams(redirectToNeonConfirmWith);
                        confirmSearchParams.set("default_selected_project_id", newProject.id);
                        router.push(`/integrations/neon/confirm?${confirmSearchParams.toString()}`);
                        await wait(2000);
                        return;
                      }

                      if (redirectToConfirmWith != null) {
                        const confirmSearchParams = new URLSearchParams(redirectToConfirmWith);
                        confirmSearchParams.set("default_selected_project_id", newProject.id);
                        router.push(`/integrations/custom/confirm?${confirmSearchParams.toString()}`);
                        await wait(2000);
                        return;
                      }

                      updateSearchParams({
                        project_id: newProject.id,
                        mode: null,
                      });
                    } finally {
                      endPendingAction(creatingProjectRef, setCreatingProject);
                    }
                  });
                }}
              >
                Create Project
              </DesignButton>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={isCreateTeamOpen} onOpenChange={setIsCreateTeamOpen}>
          <DialogContent
            className="overflow-hidden border-0 bg-white/90 p-0 shadow-2xl backdrop-blur-xl ring-1 ring-black/[0.06] dark:bg-background/75 dark:ring-white/[0.08] sm:max-w-[640px] sm:rounded-3xl"
            overlayProps={{ className: "bg-black/70 backdrop-blur-[2px]" }}
            noCloseButton
          >
            <DialogHeader className="px-6 pb-0 pt-6 text-left">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-blue-500/10 p-2.5 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400">
                  <PlusCircleIcon className="h-5 w-5" />
                </div>
                <div className="space-y-1">
                  <DialogTitle className="text-xl font-semibold tracking-tight">Create Team</DialogTitle>
                </div>
              </div>
              <DialogDescription>
                This team will be available immediately for project ownership.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-5 px-6 py-6">
              <div className="space-y-2">
                <Label htmlFor="new-team-name">Team name</Label>
                <DesignInput
                  id="new-team-name"
                  value={newTeamName}
                  onChange={(event) => setNewTeamName(event.target.value)}
                  placeholder="Acme Team"
                />
              </div>
            </div>

            <DialogFooter className="px-6 pb-6 pt-0 sm:justify-end sm:space-x-2">
              <DesignButton variant="outline" className="rounded-xl" onClick={() => setIsCreateTeamOpen(false)} disabled={creatingTeam}>
                Cancel
              </DesignButton>
              <DesignButton
                className="rounded-xl"
                loading={creatingTeam}
                onClick={() => {
                  if (!beginPendingAction(creatingTeamRef, setCreatingTeam)) {
                    return;
                  }

                  return runAsynchronouslyWithAlert(async () => {
                    const trimmedTeamName = newTeamName.trim();
                    if (trimmedTeamName.length === 0) {
                      throw new Error("Team name is required.");
                    }

                    try {
                      const createdTeam = await user.createTeam({
                        displayName: trimmedTeamName,
                      });
                      await user.setSelectedTeam(createdTeam.id);
                      setSelectedTeamId(createdTeam.id);
                      setNewTeamName("");
                      setIsCreateTeamOpen(false);
                    } finally {
                      endPendingAction(creatingTeamRef, setCreatingTeam);
                    }
                  });
                }}
              >
                Create Team
              </DesignButton>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-grow justify-center">
      <ProjectOnboardingWizard
        project={selectedProject}
        status={selectedProjectStatus ?? "config_choice"}
        onboardingState={selectedProjectOnboardingState}
        mode={mode}
        setMode={(nextMode) => updateSearchParams({ mode: nextMode })}
        setStatus={(nextStatus) => setSelectedProjectStatus(selectedProject, nextStatus)}
        setOnboardingState={(nextState) => setSelectedProjectOnboardingState(selectedProject, nextState)}
        clearOnboardingState={() => setSelectedProjectOnboardingState(selectedProject, null)}
        onComplete={() => {
          router.push(`/projects/${encodeURIComponent(selectedProject.id)}`);
        }}
      />
    </div>
  );
}
