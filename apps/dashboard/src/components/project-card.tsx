'use client';
import { Link } from "@/components/link";
import { useFromNow } from '@/hooks/use-from-now';
import { AdminProject } from '@stackframe/stack';
import { urlString } from "@stackframe/stack-shared/dist/utils/urls";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle, Typography } from '@stackframe/stack-ui';

export function ProjectCard({ project }: { project: AdminProject }) {
  const createdAt = useFromNow(project.createdAt);

  return (
    <Link href={urlString`/projects/${project.id}`}>
      <Card className='flex flex-col justify-between'>
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
      </Card>
    </Link>
  );
}
