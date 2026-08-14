"use client";

import { HourglassMediumIcon } from "@phosphor-icons/react";

/**
 * The hold: what a customer sees between finishing their interview and their report being released.
 *
 * The report is written by the analysis within minutes, but it is withheld until someone at Hexclave
 * has read it (see lib/growth/report-release.ts on the backend). Rather than showing a spinner for a
 * duration nobody can predict, the product makes a promise it can keep — come back tomorrow — and
 * during that window the workspace shows nothing but the lifecycle timeline.
 *
 * The copy lives here, in one place, because it appears on four surfaces a customer can reach during
 * the hold (the timeline's Report step, the report page, the interview completion panel, and Chat).
 * Four near-identical paragraphs drifting apart is how a product starts sounding like several
 * different products.
 *
 * It deliberately never mentions review, or a person, or approval. What is true and worth saying is
 * that the work is happening; who does it is not the customer's concern, and promising a human would
 * be a commitment this build has no way to keep.
 */
export const GROWTH_HOLD_TITLE = "We're putting your report together";

export const GROWTH_HOLD_BODY = "We're gathering the last of your product data, running the deep analysis against your interview answers, and writing it all up. Check back in about 24 hours and it'll be waiting for you.";

/** One line, for places that already have their own heading above them. */
export const GROWTH_HOLD_SHORT = "Your report will be ready in about 24 hours.";

/**
 * The standalone panel, for pages whose entire content is withheld. Matches the dashed empty-state
 * treatment the report page already used, so the hold reads as a state of the page rather than as an
 * error that replaced it.
 *
 * No spinner and no "this page updates on its own", because neither is true any more: the overview
 * stops polling during the hold (see isGrowthStatusSelfAdvancing), and the page updates on the next
 * load — which is exactly what "check back tomorrow" asks for.
 */
export function GrowthReportHoldPanel(props: { detail?: string, children?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-foreground/[0.1] bg-foreground/[0.02] p-8 text-center">
      <HourglassMediumIcon className="mx-auto size-6 text-muted-foreground/70" />
      <p className="mt-3 text-sm font-medium text-foreground">{GROWTH_HOLD_TITLE}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{props.detail ?? GROWTH_HOLD_BODY}</p>
      {props.children != null && <div className="mt-4 flex justify-center">{props.children}</div>}
    </div>
  );
}
