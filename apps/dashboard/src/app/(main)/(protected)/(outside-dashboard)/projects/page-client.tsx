'use client';

import { ProjectCard } from "@/components/project-card";
import { useRouter } from "@/components/router";
import { SearchBar } from "@/components/search-bar";
import { AdminOwnedProject, Team, TeamInvitation, useUser } from "@stackframe/stack";
import { strictEmailSchema, yupObject } from "@stackframe/stack-shared/dist/schema-fields";
import { groupBy } from "@stackframe/stack-shared/dist/utils/arrays";
import { wait } from "@stackframe/stack-shared/dist/utils/promises";
import { stringCompare } from "@stackframe/stack-shared/dist/utils/strings";
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input, Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue, Spinner, Typography, toast } from "@stackframe/stack-ui";
import { Settings } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, use } from "react";
import { listTeamInvitations } from "./action";
import * as yup from "yup";

export type SerializedTeamInvitation = {
  id: string;
  recipientEmail: string | null;
  expiresAt: string;
};

export type PageClientProps = {
  inviteUser: (origin: string, teamId: string, email: string) => Promise<void>;
  revokeTeamInvitation: (teamId: string, invitationId: string) => Promise<void>;
  allTeamInvitations: Promise<TeamInvitation[][]>;
};

export default function PageClient(props: PageClientProps) {
  const user = useUser({ or: 'redirect', projectIdMustMatch: "internal" });
  const rawProjects = user.useOwnedProjects();
  const teams = user.useTeams();
  const [sort, setSort] = useState<"recency" | "name">("recency");
  const [search, setSearch] = useState<string>("");
  const router = useRouter();

  useEffect(() => {
    if (rawProjects.length === 0) {
      router.push('/new-project');
    }
  }, [router, rawProjects]);

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
              router.push('/new-project');
              return await wait(2000);
            }}
          >Create Project
          </Button>
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
                <TeamAddUserDialog
                  team={team}
                  allTeamInvitations={props.allTeamInvitations}
                  onSubmit={(email) => props.inviteUser(window.location.origin, team.id, email)}
                  revokeInvitation={props.revokeTeamInvitation}
                />
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

type InvitationListEntry = {
  id: string;
  recipientEmail: string | null;
  expiresAt: Date;
};

function TeamAddUserDialog(props: {
  team: Team,
  allTeamInvitations: Promise<TeamInvitation[][]>,
  onSubmit: (email: string) => Promise<void>,
  revokeInvitation: (teamId: string, invitationId: string) => Promise<void>,
}) {
  const [open, setOpen] = useState(false);
  const listTeamInvitations = useCallback(
    () => props.listTeamInvitations(props.team.id),
    [props.listTeamInvitations, props.team.id],
  );
  const revokeInvitation = useCallback(
    (invitationId: string) => props.revokeInvitation(props.team.id, invitationId),
    [props.revokeInvitation, props.team.id],
  );

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Invite teammates to ${props.team.displayName}`}
        title={`Invite teammates to ${props.team.displayName}`}
        onClick={() => setOpen(true)}
      >
        <Settings className="h-4 w-4" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        {open && (
          <TeamAddUserDialogContent
            team={props.team}
            allTeamInvitations={props.allTeamInvitations}
            onSubmit={props.onSubmit}
            onClose={() => setOpen(false)}
            revokeInvitation={revokeInvitation}
          />
        )}
      </Dialog>
    </>
  );
}

function TeamAddUserDialogContent(props: {
  team: Team,
  allTeamInvitations: Promise<TeamInvitation[][]>,
  onSubmit: (email: string) => Promise<void>,
  onClose: () => void,
  revokeInvitation: (invitationId: string) => Promise<void>,
}) {
  const allTeamInvitations = use(props.allTeamInvitations);
  const invitations = allTeamInvitations.find((invitations) => invitations.some((invitation) => invitation.teamId === props.team.id));
  const users = props.team.useUsers();
  const admins = props.team.useItem("dashboard_admins");
  const invitations = use(props.listTeamInvitations());

  const [email, setEmail] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [upgradeLoading, setUpgradeLoading] = useState(false);
  const [revokingIds, setRevokingIds] = useState<Set<string>>(new Set());

  const activeSeats = users.length + invitations.length;
  const seatLimit = admins.quantity;
  const atCapacity = activeSeats >= seatLimit;

  const updateRevokingIds = (invitationId: string, isRevoking: boolean) => {
    setRevokingIds((prev) => {
      const next = new Set(prev);
      if (isRevoking) {
        next.add(invitationId);
      } else {
        next.delete(invitationId);
      }
      return next;
    });
  };

  const handleInvite = async () => {
    if (inviteLoading || atCapacity) {
      return;
    }

    try {
      setFormError(null);
      const values = await inviteFormSchema.validate({ email: email.trim() });
      setInviteLoading(true);
      await props.onSubmit(values.email);
      toast({ variant: "success", title: "Team invitation sent" });
      await loadInvitations();
      setEmail("");
    } catch (error) {
      if (error instanceof yup.ValidationError) {
        setFormError(error.errors[0] ?? error.message);
      } else {
        const message = error instanceof Error ? error.message : "Unknown error";
        toast({ variant: "destructive", title: "Failed to send invitation", description: message });
      }
    } finally {
      setInviteLoading(false);
    }
  };

  const handleUpgrade = async () => {
    if (upgradeLoading) {
      return;
    }
    try {
      setUpgradeLoading(true);
      const checkoutUrl = await props.team.createCheckoutUrl({
        productId: "team",
        returnUrl: window.location.href,
      });
      window.location.assign(checkoutUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      toast({ variant: "destructive", title: "Failed to start upgrade", description: message });
    } finally {
      setUpgradeLoading(false);
    }
  };

  const handleRevoke = async (invitationId: string) => {
    if (revokingIds.has(invitationId)) {
      return;
    }

    updateRevokingIds(invitationId, true);
    try {
      await props.revokeInvitation(invitationId);
      toast({ variant: "success", title: "Invitation revoked" });
      await loadInvitations();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      toast({ variant: "destructive", title: "Failed to revoke invitation", description: message });
    } finally {
      updateRevokingIds(invitationId, false);
    }
  };

  return (
    <DialogContent className="sm:max-w-[480px]">
      <DialogHeader>
        <DialogTitle>Invite a new user to {JSON.stringify(props.team.displayName)}</DialogTitle>
      </DialogHeader>

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
          {invitationsLoading ? (
            <div className="flex items-center justify-center py-6">
              <Spinner />
            </div>
          ) : invitationsError ? (
            <Typography variant="secondary" className="text-destructive">
              {invitationsError}
            </Typography>
          ) : invitations.length === 0 ? (
            <Typography variant="secondary">No outstanding invitations</Typography>
          ) : (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {invitations.map((invitation) => (
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
                    onClick={() => handleRevoke(invitation.id)}
                    loading={revokingIds.has(invitation.id)}
                  >
                    Revoke
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
        <Button variant="outline" onClick={props.onClose}>
          Close
        </Button>
        {atCapacity ? (
          <Button onClick={handleUpgrade} loading={upgradeLoading} variant="default">
            Upgrade plan
          </Button>
        ) : (
          <Button onClick={handleInvite} disabled={inviteLoading} loading={inviteLoading}>
            Invite
          </Button>
        )}
      </DialogFooter>
    </DialogContent>
  );
}
