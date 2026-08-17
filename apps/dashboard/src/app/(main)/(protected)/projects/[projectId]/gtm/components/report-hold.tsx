"use client";

import { HourglassMediumIcon } from "@phosphor-icons/react";

export const GROWTH_HOLD_TITLE = "We're putting your report together";

export const GROWTH_HOLD_BODY = "This takes about a day. Feel free to come back later — your report will be here when it's ready.";

export const GROWTH_HOLD_SHORT = "This takes about a day. Feel free to come back later.";
export const GROWTH_INTERVIEW_PREPARING_DETAIL = "We're putting your questions together";

/**
 * The standalone panel, for pages whose entire content is withheld. Matches the dashed empty-state
 * treatment the report page already used, so the hold reads as a state of the page rather than as an
 * error that replaced it.
 *
 * No promise that this page updates on its own: the analysis checklist carries the live progress on
 * the overview, while other surfaces update when they next load.
 */
export function GrowthReportHoldPanel(props: { title?: string, detail?: string, children?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-foreground/[0.1] bg-foreground/[0.02] p-8 text-center">
      <HourglassMediumIcon className="mx-auto size-6 text-muted-foreground/70" />
      <p className="mt-3 text-sm font-medium text-foreground">{props.title ?? GROWTH_HOLD_TITLE}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{props.detail ?? GROWTH_HOLD_BODY}</p>
      {props.children != null && <div className="mt-4 flex justify-center">{props.children}</div>}
    </div>
  );
}
