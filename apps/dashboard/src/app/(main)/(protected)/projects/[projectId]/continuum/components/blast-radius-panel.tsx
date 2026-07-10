"use client";

import { CheckCircleIcon } from "@phosphor-icons/react";
import { MIGRATIONS } from "../fixtures/databases";
import { CxChip, CxPanel, cx } from "./ui-kit";

export function BlastRadiusPanel() {
  const blastRadius = MIGRATIONS[0].blastRadius;

  return (
    <CxPanel
      title="Who could this affect?"
      meta={<CxChip tone="warn">{blastRadius.orgsAffected} orgs</CxChip>}
      bodyClassName="space-y-3 p-3"
    >
      <p className="text-sm leading-6">{blastRadius.plainSummary}</p>
      <div className="flex flex-wrap gap-1.5 tabular-nums">
        <CxChip tone="warn">{blastRadius.orgsAffected} orgs</CxChip>
        <CxChip tone="bad">{blastRadius.enterpriseOrgs} enterprise</CxChip>
        <CxChip tone="warn">${blastRadius.arrUsd.toLocaleString()} ARR</CxChip>
      </div>
      <div className="rounded-md border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2.5 text-xs leading-5 text-amber-950 dark:text-amber-100">
        {blastRadius.predictedOutcome}
      </div>
      <div>
        <p className={cx.label}>Recommended sequence</p>
        <ol className="mt-2 space-y-1.5">
          {blastRadius.recommendedSequence.map((step, index) => (
            <li key={step} className={`flex items-start gap-2 ${cx.panelInset} px-3 py-2 text-xs`}>
              <CheckCircleIcon className="mt-0.5 size-3.5 shrink-0 text-emerald-600" />
              <span><span className={`mr-1 ${cx.mono} text-muted-foreground`}>{index + 1}.</span>{step}</span>
            </li>
          ))}
        </ol>
      </div>
    </CxPanel>
  );
}
