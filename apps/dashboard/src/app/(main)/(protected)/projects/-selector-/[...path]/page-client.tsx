"use client";

import { ProjectAvatar } from "@/components/project-switcher";
import { useRouter } from "@/components/router";
import { useUser } from "@stackframe/stack";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@stackframe/stack-ui";
import { PlusIcon } from "lucide-react";
import { useEffect, useState } from "react";

export function ProjectSelectorPageClient(props: { deepPath: string }) {
  const router = useRouter();
  const user = useUser({ or: 'redirect', projectIdMustMatch: "internal" });
  const projects = user.useOwnedProjects();
  const [selectedProject, setSelectedProject] = useState<string>("");

  useEffect(() => {
    if (selectedProject) {
      const targetPath = props.deepPath
        ? `/projects/${selectedProject}/${props.deepPath}`
        : `/projects/${selectedProject}`;
      router.push(targetPath);
    }
  }, [selectedProject, props.deepPath, router]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Select a Project</CardTitle>
          <CardDescription>
            Choose a project to continue
            {props.deepPath && (
              <span className="block mt-1 text-xs">
                You&apos;ll be redirected to: /{props.deepPath}
              </span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Select value={selectedProject} onValueChange={setSelectedProject}>
            <SelectTrigger
              className="w-full h-12"
              aria-label="Select project"
            >
              <SelectValue placeholder="Choose a project..." />
            </SelectTrigger>
            <SelectContent>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  <div className="flex items-center gap-2">
                    <ProjectAvatar displayName={project.displayName} />
                    <div className="flex flex-col">
                      <span className="font-medium">{project.displayName}</span>
                      <span className="text-xs text-muted-foreground">
                        {project.id}
                      </span>
                    </div>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">
                Or
              </span>
            </div>
          </div>

          <Button
            onClick={() => router.push("/new-project")}
            variant="outline"
            className="w-full gap-2"
          >
            <PlusIcon className="h-4 w-4" />
            Create new project
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
