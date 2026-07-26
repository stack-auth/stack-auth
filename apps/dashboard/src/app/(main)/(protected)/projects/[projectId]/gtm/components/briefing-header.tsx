"use client";

import { useGtmData } from "@/lib/gtm/gtm-data";

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "2-digit", year: "numeric" }).format(date).toUpperCase();
}

export function BriefingHeader(props: { projectName: string }) {
  const { data } = useGtmData();
  let summary = "Reading the strongest product and go-to-market signals for today.";
  if (data.status === "error") summary = "Today’s briefing is unavailable because its underlying signals could not be loaded.";
  if (data.status === "loaded") {
    const leadingInsight = data.value.insights
      .sort((left, right) => right.impactScore - left.impactScore || right.createdAtMillis - left.createdAtMillis)
      .at(0);
    const leadingAction = data.value.actions
      .filter((action) => action.status === "proposed")
      .sort((left, right) => right.createdAtMillis - left.createdAtMillis)
      .at(0);
    summary = leadingInsight == null
      ? "No verified signal is ready to lead today’s briefing. Add one from GTM Admin when there is something worth sharing."
      : `${leadingInsight.title}. ${leadingAction == null ? "No action is currently waiting for review." : `The next recorded move is ${leadingAction.title.toLowerCase()}.`}`;
  }

  return (
    <header className="relative overflow-hidden rounded-[1.5rem] border border-foreground/[0.08] bg-[radial-gradient(circle_at_8%_10%,rgba(252,211,77,0.18),transparent_34%),radial-gradient(circle_at_92%_0%,rgba(125,211,252,0.18),transparent_40%),radial-gradient(circle_at_62%_110%,rgba(216,180,254,0.14),transparent_42%)] px-6 py-8 sm:px-10 sm:py-10 dark:bg-[radial-gradient(circle_at_8%_10%,rgba(161,98,7,0.14),transparent_34%),radial-gradient(circle_at_92%_0%,rgba(14,116,144,0.15),transparent_40%),radial-gradient(circle_at_62%_110%,rgba(107,33,168,0.13),transparent_42%)]">
      <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted-foreground">{formatDate(new Date())} · {props.projectName}</p>
      <p className="mt-7 font-serif text-xl italic text-foreground/65">The daily</p>
      <h1 className="mt-1 max-w-3xl text-balance font-serif text-5xl leading-[0.92] tracking-[-0.045em] text-foreground sm:text-6xl lg:text-7xl">Activity</h1>
      <p className="mt-5 max-w-3xl text-pretty text-sm leading-7 text-muted-foreground sm:text-base">{summary}</p>
    </header>
  );
}
