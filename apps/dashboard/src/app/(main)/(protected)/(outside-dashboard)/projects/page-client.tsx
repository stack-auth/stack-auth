'use client';

import { FormDialog } from "@/components/form-dialog";
import { InputField } from "@/components/form-fields";
import { ProjectCard } from "@/components/project-card";
import { useRouter } from "@/components/router";
import { SearchBar } from "@/components/search-bar";
import { AdminOwnedProject, Team, useUser } from "@stackframe/stack";
import { strictEmailSchema, yupObject } from "@stackframe/stack-shared/dist/schema-fields";
import { groupBy } from "@stackframe/stack-shared/dist/utils/arrays";
import { wait } from "@stackframe/stack-shared/dist/utils/promises";
import { stringCompare } from "@stackframe/stack-shared/dist/utils/strings";
import { Button, Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue, Typography, toast } from "@stackframe/stack-ui";
import { UserPlus } from "lucide-react";
import { Suspense, useEffect, useMemo, useState } from "react";
import * as yup from "yup";


export default function PageClient(props: { inviteUser: (origin: string, teamId: string, email: string) => Promise<void> }) {
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

      {projectsByTeam.map(({ teamId, projects }) => (
        <div key={teamId} className="mb-4">
          <Typography type="label" className="flex items-center">
            {teamId && teams.find(t => t.id === teamId) && (
              <Suspense fallback={<Button size="icon" variant="ghost" disabled><UserPlus className="w-4 h-4" /></Button>}>
                <TeamAddUserDialog
                  team={teams.find(t => t.id === teamId)!}
                  onSubmit={(email) => props.inviteUser(window.location.origin, teamId, email)}
                />
              </Suspense>
            )}
            {teamId ? teamIdMap.get(teamId) : "No Team"}
          </Typography>
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
            {projects.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

const inviteFormSchema = yupObject({
  email: strictEmailSchema("Please enter a valid email address").defined(),
});

function TeamAddUserDialog(props: {
  team: Team,
  onSubmit: (email: string) => Promise<void>,
}) {
  const users = props.team.useUsers();
  const { quantity } = props.team.useItem("dashboard_admins");

  const onSubmit = async (values: yup.InferType<typeof inviteFormSchema>) => {
    if (users.length + 1 > quantity) {
      alert("You have reached the maximum number of dashboard admins. Please upgrade your plan to add more admins.");
      const checkoutUrl = await props.team.createCheckoutUrl({ offerId: "team" });
      window.open(checkoutUrl, "_blank", "noopener");
      return "prevent-close-and-prevent-reset";
    }
    await props.onSubmit(values.email);
    toast({ variant: "success", title: "Team invitation sent" });
  };

  return <FormDialog
    title={"Invite a new user"}
    formSchema={inviteFormSchema}
    okButton={{ label: "Invite" }}
    onSubmit={onSubmit}
    trigger={<Button size="icon" variant="ghost"><UserPlus className="w-4 h-4" /></Button>}
    render={(form) => <InputField control={form.control} name="email" placeholder="Email" />}
  />;
}
