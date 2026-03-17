'use client';
import { Link } from "@/components/link";
import { DesignBadge } from "@/components/design-components/badge";
import { DesignCard } from "@/components/design-components/card";
import { useFromNow } from '@/hooks/use-from-now';
import { AdminProject } from '@stackframe/stack';
import { urlString } from "@stackframe/stack-shared/dist/utils/urls";
import { FolderOpenIcon } from "@phosphor-icons/react";
import { Typography } from '@/components/ui';

export function ProjectCard(props: {
  project: AdminProject,
  href?: string,
  showIncompleteBadge?: boolean,
}) {
  const createdAt = useFromNow(props.project.createdAt);
  const href = props.href ?? urlString`/projects/${props.project.id}`;

  return (
    <Link href={href}>
      <DesignCard
        title={props.project.displayName}
        icon={FolderOpenIcon}
        subtitle={props.project.description || "No description yet"}
        className="h-full"
        gradient={props.showIncompleteBadge ? "orange" : "default"}
        glassmorphic
        actions={props.showIncompleteBadge ? <DesignBadge label="Setup incomplete" color="orange" size="sm" /> : null}
      >
        <div className="flex justify-end">
          <Typography type='label' variant='secondary'>
            {createdAt}
          </Typography>
        </div>
      </DesignCard>
    </Link>
  );
}
