"use client";

import { PageLayout } from "../../page-layout";
import { useAdminApp } from "../../use-admin-app";
import { CaretDownIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { BriefingHeader } from "./briefing-header";
import { DomainWorkspace } from "./domain-workspace";
import { UnifiedFeed } from "./unified-feed";

export function GtmOverview(props: { toolbar: ReactNode, activityAction?: ReactNode, project?: { id: string, displayName: string } }) {
  const routeProject = useAdminApp().useProject();
  const project = props.project ?? routeProject;

  return (
    <PageLayout allowContentOverflow width={1600}>
      <div className="space-y-8 lg:space-y-12">
        {props.toolbar}
        <article className="overflow-hidden rounded-2xl border border-foreground/[0.08] bg-background p-4 sm:p-6">
          <BriefingHeader projectName={project.displayName} action={props.activityAction} />
          <details className="group mt-4">
            <summary className="flex cursor-pointer list-none items-center justify-between border-t border-foreground/[0.08] px-2 py-5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 [&::-webkit-details-marker]:hidden">
              <span>Open today’s short brief</span>
              <CaretDownIcon className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-open:rotate-180" />
            </summary>
            <section className="grid gap-8 border-t border-foreground/[0.08] px-2 pb-6 pt-8 lg:grid-cols-[12rem_minmax(0,1fr)]">
              <div>
                <h2 className="font-serif text-3xl leading-none tracking-tight">Prepared for you</h2>
                <p className="mt-4 max-w-[12rem] text-sm leading-6 text-muted-foreground">
                  The few findings that deserve attention today.
                </p>
              </div>
              <UnifiedFeed limit={2} />
            </section>
          </details>
        </article>
        <DomainWorkspace projectId={project.id} projectName={project.displayName} />
      </div>
    </PageLayout>
  );
}
