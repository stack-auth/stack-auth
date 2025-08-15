'use client';

import { ProjectCard } from "@/components/project-card";
import { useRouter } from "@/components/router";
import { SearchBar } from "@/components/search-bar";
import { AdminOwnedProject, useUser } from "@stackframe/stack";
import { groupBy } from "@stackframe/stack-shared/dist/utils/arrays";
import { wait } from "@stackframe/stack-shared/dist/utils/promises";
import { stringCompare } from "@stackframe/stack-shared/dist/utils/strings";
import { Button, Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue, Typography } from "@stackframe/stack-ui";
import { useEffect, useMemo, useState } from "react";


export default function PageClient() {
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
    return Array.from(grouped.entries()).map(([teamId, projects]) => {
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
          <Typography type="label" className="mb-2 ml-2">{teamId ? teamIdMap.get(teamId) : "No Team"}</Typography>
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
