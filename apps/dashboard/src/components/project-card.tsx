'use client';
import { Link } from "@/components/link";
import { useFromNow } from '@/hooks/use-from-now';
import { AdminProject } from '@stackframe/stack';
import { CardDescription, CardFooter, CardHeader, CardTitle, ClickableCard, Typography } from '@stackframe/stack-ui';

export function ProjectCard({ project }: { project: AdminProject }) {
  const createdAt = useFromNow(project.createdAt);

  return (
    <Link href={`/projects/${project.id}`}>
      <ClickableCard className='flex flex-col justify-between'>
        <CardHeader>
          <CardTitle className="normal-case truncate">{project.displayName}</CardTitle>
          <CardDescription>{project.description}</CardDescription>
        </CardHeader>
        <CardFooter className="flex justify-between mt-2">
          <Typography type='label' variant='secondary'>
            {project.userCount} users
          </Typography>
          <Typography type='label' variant='secondary'>
            {createdAt}
          </Typography>
        </CardFooter>
      </ClickableCard>
    </Link>
  );
}
