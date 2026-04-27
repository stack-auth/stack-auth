'use client';
import { DesignBadge } from "@/components/design-components/badge";
import { DesignCard } from "@/components/design-components/card";
import { Link } from "@/components/link";
import { ProjectDauSparkline } from "@/components/project-dau-sparkline";
import { useFromNow } from '@/hooks/use-from-now';
import { FolderOpenIcon } from "@phosphor-icons/react";
import { AdminProject } from '@stackframe/stack';
import { urlString } from "@stackframe/stack-shared/dist/utils/urls";

export function ProjectCard(props: {
  project: AdminProject,
  href?: string,
  showIncompleteBadge?: boolean,
  dau?: { date: string, activity: number }[],
}) {
  const createdAt = useFromNow(props.project.createdAt);
  const href = props.href ?? urlString`/projects/${props.project.id}`;

  return (
    <Link href={href}>
      <DesignCard
        className="h-full"
        contentClassName="p-3"
        gradient={props.showIncompleteBadge ? "orange" : "default"}
        glassmorphic
      >
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.06] ring-1 ring-black/[0.04] dark:ring-white/[0.04]">
            <FolderOpenIcon className="h-4 w-4 text-foreground/70" weight="duotone" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="truncate text-sm font-semibold leading-tight tracking-tight text-foreground">
                {props.project.displayName}
              </h3>
              {props.showIncompleteBadge ? (
                <DesignBadge label="Setup incomplete" color="orange" size="sm" />
              ) : (
                <span className="shrink-0 text-[10px] text-muted-foreground/80 whitespace-nowrap">
                  {createdAt}
                </span>
              )}
            </div>
            <p className="truncate text-xs leading-snug text-muted-foreground">
              {props.project.description || "No description yet"}
            </p>
          </div>
        </div>

        <div className="-mx-3 -mb-3 mt-3 overflow-hidden rounded-b-2xl border-t border-black/[0.08] dark:border-white/[0.06] px-3 pt-3 pb-3">
          <ProjectDauSparkline data={props.dau} />
        </div>
      </DesignCard>
    </Link>
  );
}
