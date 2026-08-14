"use client";

import { DesignAlert, DesignBadge, DesignButton } from "@/components/design-components";
import { Link } from "@/components/link";
import { getGrowthOverview } from "@/lib/growth/growth-api";
import { type GrowthLoadable, useGrowthStatus } from "@/lib/growth/growth-data";
import { buildGrowthDemoOverview, GROWTH_DEMO_NOW_MILLIS } from "@/lib/growth/growth-demo-data";
import type { GrowthOverviewFinding } from "@/lib/growth/growth-types";
import { captureError } from "@hexclave/shared/dist/utils/errors";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { ArrowLeftIcon } from "@phosphor-icons/react";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { PageLayout } from "../../../page-layout";
import { useAdminApp, useProjectId } from "../../../use-admin-app";
import { useGrowthHref } from "../../components/action-card";
import { GrowthAppFrame } from "../../components/frame";
import { GrowthDocumentRenderer } from "../../components/growth-document";

export default function PageClient() {
  return (
    <GrowthAppFrame>
      <PageLayout title="Growth Evidence" description="Finding detail and supporting evidence" allowContentOverflow>
        <FindingDetailBody />
      </PageLayout>
    </GrowthAppFrame>
  );
}

function FindingDetailBody() {
  const app = useAdminApp();
  const projectId = useProjectId();
  const withQuery = useGrowthHref();
  const { demo } = useGrowthStatus();
  const params = useParams<{ findingId: string }>();
  const findingId = params.findingId;
  const [data, setData] = useState<GrowthLoadable<GrowthOverviewFinding | null>>({ status: "loading" });

  const load = useCallback(async () => {
    try {
      const overview = demo
        ? buildGrowthDemoOverview(GROWTH_DEMO_NOW_MILLIS)
        : await getGrowthOverview(app);
      const finding = [...overview.findings, ...overview.notes].find((item) => item.id === findingId) ?? null;
      setData({ status: "loaded", value: finding });
    } catch (error) {
      captureError("growth-finding-detail-load", error);
      setData({ status: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }, [app, demo, findingId]);

  useEffect(() => {
    setData({ status: "loading" });
    runAsynchronously(load());
  }, [load]);

  const backLink = (
    <Link
      href={withQuery(`/projects/${projectId}/growth`)}
      className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground hover:transition-none"
    >
      <ArrowLeftIcon className="size-4" />
      Growth overview
    </Link>
  );

  if (data.status === "loading") {
    return (
      <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading evidence">
        {backLink}
        <div className="h-64 animate-pulse rounded-2xl border border-foreground/[0.06] bg-foreground/[0.03]" />
      </div>
    );
  }

  if (data.status === "error") {
    return (
      <div className="flex flex-col gap-4">
        {backLink}
        <DesignAlert variant="error" className="items-center">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>Could not load this evidence: {data.message}</span>
            <DesignButton variant="outline" size="sm" onClick={async () => {
              setData({ status: "loading" });
              await load();
            }}>
              Retry
            </DesignButton>
          </div>
        </DesignAlert>
      </div>
    );
  }

  if (data.value == null) {
    return (
      <div className="flex flex-col gap-4">
        {backLink}
        <div className="rounded-2xl border border-dashed border-foreground/[0.1] bg-foreground/[0.02] p-8 text-center">
          <p className="text-sm text-muted-foreground">
            This evidence does not exist (or was removed). Head back to the Growth overview to see the latest findings.
          </p>
        </div>
      </div>
    );
  }

  const finding = data.value;
  return (
    <div className="flex flex-col gap-4">
      {backLink}
      <article className="border-y border-foreground/[0.08] py-7">
        <header>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <time>{new Date(finding.createdAtMillis).toLocaleDateString()}</time>
            <span aria-hidden="true">·</span>
            <span>{finding.source}</span>
            <span aria-hidden="true">·</span>
            <span>{finding.kind}</span>
          </div>
          <h2 className="mt-3 max-w-4xl text-balance text-xl font-semibold tracking-tight">{finding.title}</h2>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {finding.category != null && <DesignBadge label={finding.category} color="cyan" size="sm" />}
            {finding.tags.map((tag) => <DesignBadge key={tag} label={tag} color="blue" size="sm" />)}
          </div>
        </header>
        <div className="mt-7 border-t border-foreground/[0.08] pt-7">
          {finding.document == null
            ? <p className="max-w-3xl whitespace-pre-wrap text-sm leading-7 text-muted-foreground">{finding.body}</p>
            : <GrowthDocumentRenderer document={finding.document} className="mx-0" />}
        </div>
      </article>
    </div>
  );
}
