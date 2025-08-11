'use client';
import { Link } from "@/components/link";
import { useFromNow } from '@/hooks/use-from-now';
import { AdminProject, useUser } from '@stackframe/stack';
import { urlString } from "@stackframe/stack-shared/dist/utils/urls";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle, Typography } from '@stackframe/stack-ui';

export function ProjectCard({ project }: { project: AdminProject }) {
  const user = useUser({ "or": "redirect", projectIdMustMatch: "internal" });
  const team = user.useTeam(project.ownerTeamId ?? "");
  const createdAt = useFromNow(project.createdAt);

  return (
    <Link href={urlString`/projects/${project.id}`}>
      <Card className='flex flex-col justify-between h-full'>
        <CardHeader>
          <CardTitle className="normal-case truncate">{project.displayName}</CardTitle>
          <CardDescription>{team?.displayName}</CardDescription>
          <CardDescription>{project.description}</CardDescription>
        </CardHeader>
        <CardFooter className="flex justify-end mt-2">
          <Typography type='label' variant='secondary'>
            {createdAt}
          </Typography>
        </CardFooter>
      </Card>
    </Link>
  );
}
