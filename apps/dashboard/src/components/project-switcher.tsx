"use client";
import { useRouter } from "@/components/router";
import { PlusIcon } from "@phosphor-icons/react";
import { useUser } from "@stackframe/stack";
import { Button, Select, SelectContent, SelectItem, SelectTrigger } from "@stackframe/stack-ui";
import { useMemo } from "react";

export function ProjectAvatar(props: { displayName: string }) {
  return (
    <div className="min-w-7 min-h-7 max-w-7 max-h-7 rounded-sm bg-zinc-200 dark:bg-zinc-700 mr-1 flex items-center justify-center">
      <p>
        {props.displayName.slice(0,1).toUpperCase()}
      </p>
    </div>
  );
}

export function ProjectSwitcher(props: { currentProjectId: string }) {
  const router = useRouter();
  const user = useUser({ or: 'redirect', projectIdMustMatch: "internal" });
  const rawProjects = user.useOwnedProjects();
  const { currentProject, projects } = useMemo(() => {
    const currentProject = rawProjects.find((project) => project.id === props.currentProjectId);
    const projects = rawProjects.sort((a, b) => b.id === props.currentProjectId ? 1 : -1);
    return { currentProject, projects };
  }, [props.currentProjectId, rawProjects]);

  return (
    <div className="flex items-center gap-1">
      <div className="flex items-center gap-1">
        <ProjectAvatar displayName={currentProject?.displayName || ""} />
        <span className="truncate text-sm font-medium">
          {currentProject?.displayName}
        </span>
      </div>
      <Select defaultValue={props.currentProjectId} onValueChange={(value) => { router.push(`/projects/${value}`); }}>
        <SelectTrigger
          className="h-6 w-6 p-0 border border-transparent bg-transparent shadow-none hover:bg-accent hover:border-border rounded-md justify-center transition-all"
          aria-label="Select account"
        />
        <SelectContent>
          {projects.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              <div className="flex items-center gap-2">
                <ProjectAvatar displayName={p.displayName} />
                <span className="max-w-64 truncate">
                  { p.displayName }
                </span>
              </div>
            </SelectItem>
          ))}
          <Button onClick={() => router.push("/new-project")} variant="outline" className="w-full mt-2 gap-1">
            <PlusIcon className="h-4 w-4" />
            Create new project
          </Button>
        </SelectContent>
      </Select>
    </div>
  );
}
