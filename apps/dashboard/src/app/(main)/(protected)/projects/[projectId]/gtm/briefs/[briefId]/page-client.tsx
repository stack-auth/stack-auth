"use client";

import { DesignAlert, DesignButton, DesignCard } from "@/components/design-components";
import { StyledLink } from "@/components/link";
import { getGrowthBrief, markGrowthBriefRead } from "@/lib/growth/growth-api";
import { useGrowthStatus } from "@/lib/growth/growth-data";
import { buildGrowthDemoBriefs, GROWTH_DEMO_NOW_MILLIS } from "@/lib/growth/growth-demo-data";
import { formatGrowthBriefDateHeadline } from "@/lib/growth/growth-format";
import type { GrowthBrief } from "@/lib/growth/growth-types";
import { captureError, throwErr } from "@hexclave/shared/dist/utils/errors";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { CircleNotchIcon, NewspaperIcon } from "@phosphor-icons/react";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAdminApp, useProjectId } from "../../../use-admin-app";
import { PageLayout } from "../../../page-layout";
import { GrowthAppFrame } from "../../components/frame";
import { GrowthMarkdown } from "../../components/report-sections";
import { GrowthDocumentRenderer } from "../../components/growth-document";

type BriefState =
  | { status: "loading" }
  | { status: "error", message: string }
  | { status: "loaded", brief: GrowthBrief };

function BriefBody(props: { brief: GrowthBrief }) {
  const { brief } = props;
  switch (brief.status) {
    case "generating": {
      return (
        <DesignCard title="Writing today's brief" subtitle="Check back in a few minutes" icon={CircleNotchIcon} gradient="cyan">
          <p className="text-sm text-muted-foreground">
            We are still comparing this day&apos;s numbers against the day before. The finished brief shows up here automatically.
          </p>
        </DesignCard>
      );
    }
    case "failed": {
      return (
        <DesignAlert variant="error">
          This brief could not be generated. Tomorrow&apos;s brief is unaffected — no action needed on your side.
        </DesignAlert>
      );
    }
    case "skipped": {
      return (
        <DesignAlert variant="info">
          No brief was written for this day — there was not enough new data to compare against the day before.
        </DesignAlert>
      );
    }
    case "ready": {
      if (brief.document != null) {
        return (
          <div className="flex flex-col gap-7">
            <header className="border-b border-foreground/[0.08] pb-5">
              <p className="text-xs text-muted-foreground">All comparisons use the previous UTC day unless the evidence states another timezone.</p>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{brief.summary}</p>
            </header>
            <GrowthDocumentRenderer document={brief.document} />
          </div>
        );
      }
      return (
        <DesignCard title="Daily brief" subtitle="All comparisons are against the previous day (UTC)" icon={NewspaperIcon} gradient="cyan">
          <GrowthMarkdown content={brief.contentMd} />
        </DesignCard>
      );
    }
  }
}

function BriefDetail(props: { briefId: string }) {
  const { briefId } = props;
  const app = useAdminApp();
  const projectId = useProjectId();
  const { demo } = useGrowthStatus();
  const [state, setState] = useState<BriefState>({ status: "loading" });
  // Guards the read receipt across re-renders AND across refetches of the same brief; keyed by id so
  // navigating to a different brief within the same mounted component still marks the new one.
  const markedReadBriefIdRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (demo) {
      const brief = buildGrowthDemoBriefs(GROWTH_DEMO_NOW_MILLIS).find((candidate) => candidate.id === briefId);
      if (brief == null) {
        setState({ status: "error", message: "This demo brief does not exist. Head back to the Growth overview." });
        return;
      }
      setState({ status: "loaded", brief });
      return;
    }
    try {
      setState({ status: "loaded", brief: await getGrowthBrief(app, briefId) });
    } catch (error) {
      captureError("growth-brief-load", error);
      setState({ status: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }, [app, briefId, demo]);

  useEffect(() => {
    setState({ status: "loading" });
    runAsynchronously(load());
  }, [load]);

  const shouldMarkRead = !demo
    && state.status === "loaded"
    && state.brief.status === "ready"
    && state.brief.readAtMillis == null
    && markedReadBriefIdRef.current !== briefId;
  useEffect(() => {
    if (!shouldMarkRead) return;
    markedReadBriefIdRef.current = briefId;
    // Fire-and-forget on purpose: the read receipt only drives the unread dot on the list page, so
    // blocking the brief render on it (or raising a blocking alert if it fails) would punish the user
    // for a cosmetic write. Failures are captured, and the only consequence is the dot sticking around.
    runAsynchronously(async () => {
      try {
        await markGrowthBriefRead(app, briefId);
      } catch (error) {
        captureError("growth-brief-mark-read", error);
      }
    });
  }, [app, briefId, shouldMarkRead]);

  const headline = state.status === "loaded" ? formatGrowthBriefDateHeadline(state.brief.date) : "One day's brief in full";
  return (
    <PageLayout
      title="Daily Brief"
      description={headline}
      actions={<StyledLink href={`/projects/${projectId}/gtm`} className="text-sm no-underline hover:underline">← Growth overview</StyledLink>}
    >
      {state.status === "loading" && (
        <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading brief">
          <div className="h-64 animate-pulse rounded-2xl border border-foreground/[0.06] bg-foreground/[0.03]" />
        </div>
      )}
      {state.status === "error" && (
        <DesignAlert variant="error">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>Could not load this brief: {state.message}</span>
            <DesignButton variant="outline" size="sm" onClick={async () => await load()}>Retry</DesignButton>
          </div>
        </DesignAlert>
      )}
      {state.status === "loaded" && <BriefBody brief={state.brief} />}
    </PageLayout>
  );
}

export default function PageClient() {
  // useParams' generic is a lie the router can't verify, so re-check the param at runtime instead of
  // trusting the cast — a rename of the [briefId] segment should fail loudly here, not fetch "undefined".
  const params = useParams();
  const briefIdParam = params.briefId;
  const briefId = typeof briefIdParam === "string" ? briefIdParam : throwErr("briefId route param missing — this page is only reachable under /briefs/[briefId]");
  return (
    <GrowthAppFrame>
      <BriefDetail briefId={briefId} />
    </GrowthAppFrame>
  );
}
