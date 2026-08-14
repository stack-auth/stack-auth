"use client";

import { DesignAlert, DesignBadge, DesignButton, DesignCategoryTabs } from "@/components/design-components";
import { Link } from "@/components/link";
import { cn } from "@/components/ui";
import { getGrowthOverview } from "@/lib/growth/growth-api";
import { getGrowthPublishedQuiz } from "@/lib/growth/games/growth-games-api";
import type { GrowthPublishedQuiz } from "@/lib/growth/games/growth-games-types";
import { buildGrowthDemoOverview, buildGrowthDemoPublishedQuiz, GROWTH_DEMO_NOW_MILLIS } from "@/lib/growth/growth-demo-data";
import { useGrowthStatus } from "@/lib/growth/growth-data";
import { GROWTH_CATEGORIES, type GrowthActionItem, type GrowthCategory, type GrowthOverview, type GrowthOverviewFinding, type GrowthStatus } from "@/lib/growth/growth-types";
import { captureError, throwErr } from "@hexclave/shared/dist/utils/errors";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { ArrowRightIcon, /* CaretDownIcon, */ CoinsIcon, CubeIcon, CursorClickIcon, FileTextIcon, FlagBannerIcon, UsersThreeIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useAdminApp, useProjectId } from "../../use-admin-app";
import { useGrowthHref } from "./action-card";
import { QuizBanner } from "./games/quiz-banner";
import { QuizDialog } from "./games/quiz-dialog";

const CATEGORY_PRESENTATION = new Map<GrowthCategory, { label: string, icon: typeof UsersThreeIcon }>([
  ["product", { label: "Product", icon: CubeIcon }],
  ["reach", { label: "Reach", icon: UsersThreeIcon }],
  ["conversion", { label: "Conversion", icon: CursorClickIcon }],
  ["retention", { label: "Retention", icon: FlagBannerIcon }],
  ["revenue", { label: "Revenue", icon: CoinsIcon }],
]);

type Loadable = { status: "loading" } | { status: "error", message: string } | { status: "loaded", value: GrowthOverview };

function formatDate(millis: number): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "2-digit", year: "numeric" }).format(millis).toUpperCase();
}

function categoryLabel(category: GrowthCategory | null): string {
  if (category == null) return "Needs category";
  return CATEGORY_PRESENTATION.get(category)?.label ?? throwErr(`Missing Growth category presentation for ${category}`);
}

const GROWTH_JOURNEY_POSITIONS = new Map<GrowthCategory, string>([
  ["product", "left-1/2 top-[2%] -translate-x-1/2"],
  ["reach", "right-0 top-[23%]"],
  ["conversion", "right-[7%] bottom-[12%]"],
  ["retention", "left-[7%] bottom-[12%]"],
  ["revenue", "left-0 top-[23%]"],
]);

// Explicit arrowheads avoid SVG marker color inheritance, which rendered the heads at full contrast
// in light mode. Each open chevron terminates exactly at its line endpoint so the cycle stays aligned.
const GROWTH_JOURNEY_ARROWS = [
  { line: "M 64 11.5 L 76 21", head: "M 75.02 20.79 L 76 21 L 75.57 20.09" },
  { line: "M 88 34 L 83 76", head: "M 82.66 75.05 L 83 76 L 83.55 75.16" },
  { line: "M 69 84 L 31 84", head: "M 31.9 83.55 L 31 84 L 31.9 84.45" },
  { line: "M 17 76 L 12 34", head: "M 12.55 34.84 L 12 34 L 11.66 34.95" },
  { line: "M 24 21 L 36 11.5", head: "M 35.57 12.41 L 36 11.5 L 35.02 11.71" },
] as const;

function GrowthJourney(props: { categories: GrowthOverview["categories"], selected: GrowthCategory, projectName: string, onSelect: (category: GrowthCategory) => void }) {
  const ordered = GROWTH_CATEGORIES.map((category) => props.categories.find((item) => item.category === category)
    ?? throwErr(`Growth overview response omitted ${category}.`));
  const scorePoints = ordered.map((item, index) => {
    const angleRadians = (-90 + index * 72) * Math.PI / 180;
    const radius = 22 * (item.score ?? 0) / 100;
    return `${50 + Math.cos(angleRadians) * radius},${46 + Math.sin(angleRadians) * radius}`;
  }).join(" ");
  return (
    <div className="relative mx-auto mt-8 aspect-square w-full max-w-xl" aria-label="Growth journey">
      <svg className="pointer-events-none absolute inset-0 size-full overflow-visible text-foreground" viewBox="0 0 100 100" aria-hidden="true">
        <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeOpacity="0.11" strokeWidth="0.18">
          {GROWTH_JOURNEY_ARROWS.map((arrow) => (
            <g key={arrow.line}>
              <path d={arrow.line} />
              <path d={arrow.head} />
            </g>
          ))}
        </g>
        <g className="text-foreground/[0.12]" fill="none" stroke="currentColor" strokeWidth="0.35">
          <polygon points="50,20 72,33 72,59 50,72 28,59 28,33" />
          <polygon points="50,27 66,36 66,55 50,64 34,55 34,36" />
          <polygon points="50,34 60,40 60,51 50,57 40,51 40,40" />
          <path d="M 50 20 V 72 M 28 33 L 72 59 M 72 33 L 28 59" />
        </g>
        <polygon className="text-foreground/55" points={scorePoints} fill="currentColor" fillOpacity="0.12" stroke="currentColor" strokeWidth="0.5" />
      </svg>

      <div className="pointer-events-none absolute left-1/2 top-[46%] w-36 -translate-x-1/2 -translate-y-1/2 text-center">
        <p className="text-pretty font-serif text-lg leading-tight tracking-tight sm:text-xl">{props.projectName}</p>
      </div>

      {ordered.map((item) => {
        const presentation = CATEGORY_PRESENTATION.get(item.category) ?? throwErr(`Missing Growth category presentation for ${item.category}`);
        const Icon = presentation.icon;
        const selected = props.selected === item.category;
        const position = GROWTH_JOURNEY_POSITIONS.get(item.category) ?? throwErr(`Missing Growth journey position for ${item.category}`);
        return (
          <button
            key={item.category}
            type="button"
            aria-pressed={selected}
            onClick={() => props.onSelect(item.category)}
            className={cn(
              "absolute z-10 flex min-h-12 w-28 items-center gap-2 rounded-xl border bg-background px-3 py-2 text-left transition-colors duration-150 hover:transition-none focus-visible:outline-none focus-visible:ring-2 sm:w-32",
              position,
              selected ? "border-foreground bg-foreground text-background" : "border-foreground/[0.1] hover:border-foreground/30",
            )}
          >
            <Icon className="size-4 shrink-0" />
            <span className="min-w-0">
              <span className="block truncate text-[11px] font-semibold sm:text-sm">{presentation.label}</span>
              <span className="block font-mono text-[8px] uppercase tracking-[0.1em] opacity-65">{item.score == null ? "Not scored" : `${item.score} score`}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Badges(props: { category: GrowthCategory | null, tags: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <DesignBadge label={categoryLabel(props.category)} color={props.category == null ? "orange" : "cyan"} size="sm" />
      {props.tags.map((tag) => <DesignBadge key={tag} label={tag} color="blue" size="sm" />)}
    </div>
  );
}

function SuggestionRow(props: { item: { kind: "finding", value: GrowthOverviewFinding } | { kind: "action", value: GrowthActionItem }, projectId: string }) {
  const withQuery = useGrowthHref();
  const value = props.item.value;
  const href = props.item.kind === "action"
    ? `/projects/${props.projectId}/gtm/actions/${value.id}`
    : `/projects/${props.projectId}/gtm/findings/${value.id}`;
  const body = props.item.kind === "action" ? props.item.value.description : props.item.value.body;
  const content = (
    <article className="grid gap-3 border-b border-foreground/[0.08] px-1 py-5 text-left last:border-0 sm:grid-cols-[7rem_minmax(0,1fr)_auto] sm:items-start">
      <time className="text-xs text-muted-foreground">{formatDate(value.createdAtMillis)}</time>
      <div className="min-w-0">
        <h4 className="text-sm font-semibold leading-6 tracking-tight">{value.title}</h4>
        <p className="mt-1 line-clamp-2 text-sm leading-6 text-muted-foreground">{body}</p>
        <div className="mt-3"><Badges category={value.category} tags={value.tags} /></div>
      </div>
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground">{props.item.kind === "action" ? "Review action" : "Read evidence"}<ArrowRightIcon className="size-3.5" /></span>
    </article>
  );
  return <Link href={withQuery(href)} className="block rounded-xl focus-visible:outline-none focus-visible:ring-2">{content}</Link>;
}

export type GrowthHighlight = {
  kind: "brief" | "report",
  summary: string,
  createdAtMillis: number,
  href: string,
};

/**
 * Picks the one document the workspace hero leads with.
 *
 * Day one has a finished deep-analysis report but no daily brief yet — briefs need a full day of
 * metrics to compare the day against — so the report holds this slot until the first brief lands,
 * and briefs take over from then on. Both are "the latest thing the agent prepared for you", but
 * they are different documents on different cadences, so the caller switches its copy on `kind`
 * rather than announcing a one-off deep analysis as "today's short brief".
 *
 * Pure and exported so both branches are unit-testable: a dev database realistically only ever holds
 * one of the two states at a time, which makes the day-one branch the easy one to break unnoticed.
 */
export function selectGrowthHighlight(overview: GrowthOverview, projectId: string): GrowthHighlight | null {
  const brief = overview.latestBrief;
  if (brief != null) {
    return { kind: "brief", summary: brief.summary, createdAtMillis: brief.createdAtMillis, href: `/projects/${projectId}/gtm/briefs/${brief.id}` };
  }
  const report = overview.latestReport;
  if (report != null) {
    // The report page always renders the latest report, so it needs no id in the path.
    return { kind: "report", summary: report.summary, createdAtMillis: report.createdAtMillis, href: `/projects/${projectId}/gtm/report` };
  }
  return null;
}

/** The newest published report stays highlighted until this shared project workspace has opened it. */
export function getUnreadGrowthReport(status: GrowthStatus | undefined): GrowthStatus["latestReport"] {
  const report = status?.latestReport ?? null;
  return report?.readAtMillis == null ? report : null;
}

export function GrowthWorkspaceContent(props: {
  overview: GrowthOverview,
  status?: GrowthStatus,
  projectId: string,
  projectName: string,
  /**
   * Rendered directly above the stage/insights section. Passed in rather than fetched here because
   * this component is ALSO the admin page's read-only preview of a customer workspace, and that page
   * has no business firing the customer's own quiz request. The customer wrapper below passes the
   * live banner; the admin preview passes nothing.
   */
  quizBanner?: ReactNode,
}) {
  const withQuery = useGrowthHref();
  const [selected, setSelected] = useState<GrowthCategory>("conversion");
  const [lane, setLane] = useState<"suggestions" | "notes">("suggestions");
  const category = props.overview.categories.find((item) => item.category === selected)
    ?? throwErr(`Growth overview response omitted ${selected}.`);
  const suggestions: Array<{ kind: "finding", value: GrowthOverviewFinding } | { kind: "action", value: GrowthActionItem }> = [];
  for (const value of props.overview.findings.filter((item) => item.category === selected)) suggestions.push({ kind: "finding", value });
  for (const value of props.overview.actions.filter((item) => item.category === selected)) suggestions.push({ kind: "action", value });
  suggestions.sort((left, right) => right.value.createdAtMillis - left.value.createdAtMillis);
  const notes = props.overview.notes.filter((item) => item.category === selected);
  // const highlight = selectGrowthHighlight(props.overview, props.projectId);
  const rerunActive = props.status?.latestReport != null && props.status.analysis.state === "running";
  const unreadReport = getUnreadGrowthReport(props.status);

  return (
    <div className="space-y-8 lg:space-y-12">
      {rerunActive && (
        <DesignAlert variant="info">
          A fresh analysis is running in the background. This workspace stays available and will update when the run completes.
        </DesignAlert>
      )}
      {unreadReport != null && (
        <div className="flex justify-end">
          <Link href={withQuery(`/projects/${props.projectId}/gtm/report`)}>
            <DesignButton variant="outline" size="sm">
              <FileTextIcon className="size-4" />
              Read your report
              <ArrowRightIcon className="size-3.5" />
            </DesignButton>
          </Link>
        </div>
      )}
      {/* <article className="overflow-hidden rounded-2xl border border-foreground/[0.08] bg-background p-4 sm:p-6">
        <header className="relative overflow-hidden rounded-[1.5rem] border border-foreground/[0.08] bg-[radial-gradient(circle_at_8%_10%,rgba(252,211,77,0.18),transparent_34%),radial-gradient(circle_at_92%_0%,rgba(125,211,252,0.18),transparent_40%),radial-gradient(circle_at_62%_110%,rgba(216,180,254,0.14),transparent_42%)] px-6 py-8 sm:px-10 sm:py-10 dark:bg-[radial-gradient(circle_at_8%_10%,rgba(161,98,7,0.14),transparent_34%),radial-gradient(circle_at_92%_0%,rgba(14,116,144,0.15),transparent_40%),radial-gradient(circle_at_62%_110%,rgba(107,33,168,0.13),transparent_42%)]">
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted-foreground">{highlight == null ? "GROWTH WORKSPACE" : formatDate(highlight.createdAtMillis)} · {props.projectName}</p>
          <p className="mt-7 font-serif text-xl italic text-foreground/65">{highlight?.kind === "report" ? "The complete" : "The daily"}</p>
          <h1 className="mt-1 max-w-3xl text-balance font-serif text-5xl leading-[0.92] tracking-[-0.045em] sm:text-6xl lg:text-7xl">{highlight?.kind === "report" ? "Analysis" : "Activity"}</h1>
          <p className="mt-5 max-w-3xl text-pretty text-sm leading-7 text-muted-foreground sm:text-base">{highlight?.summary ?? "Your first Growth summary will appear here once analysis has enough evidence."}</p>
        </header>
        <details className="group mt-4">
          <summary className="flex cursor-pointer list-none items-center justify-between border-t border-foreground/[0.08] px-2 py-5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 [&::-webkit-details-marker]:hidden">
            <span>{highlight?.kind === "report" ? "Open the deep analysis" : "Open today’s short brief"}</span>
            <CaretDownIcon className="size-4 text-muted-foreground transition-transform duration-200 group-open:rotate-180" />
          </summary>
          <section className="grid gap-8 border-t border-foreground/[0.08] px-2 pb-6 pt-8 lg:grid-cols-[12rem_minmax(0,1fr)]">
            <div><h2 className="font-serif text-3xl leading-none tracking-tight">Prepared for you</h2><p className="mt-4 max-w-[12rem] text-sm leading-6 text-muted-foreground">{highlight?.kind === "report" ? "The full deep analysis of your project." : "The few findings that deserve attention today."}</p></div>
            {highlight == null ? (
              <div className="rounded-xl border border-dashed p-6"><p className="font-medium">Nothing to read yet</p><p className="mt-2 text-sm leading-6 text-muted-foreground">Your deep analysis appears here as soon as the first run finishes; daily briefs take over from the day after.</p></div>
            ) : (
              <div className="rounded-xl border p-6"><p className="text-sm leading-7 text-muted-foreground">{highlight.summary}</p><Link href={highlight.href} className="mt-5 inline-flex items-center gap-2 text-sm font-medium">{highlight.kind === "report" ? "Read the deep analysis" : "Read the brief"} <ArrowRightIcon className="size-4" /></Link></div>
            )}
          </section>
        </details>
      </article> */}

      <section className="rounded-2xl border border-foreground/[0.08] bg-background px-5 pb-8 pt-10 sm:px-8 lg:px-12">
        {props.quizBanner}
        <header className="mx-auto max-w-2xl text-center"><p className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">{props.projectName} growth journey</p><h2 className="mt-3 text-balance font-serif text-4xl leading-none tracking-tight sm:text-5xl">From product to revenue.</h2><p className="mx-auto mt-4 text-sm text-muted-foreground">Choose a stage to focus the workspace.</p></header>
        <GrowthJourney categories={props.overview.categories} selected={selected} projectName={props.projectName} onSelect={setSelected} />
        {props.overview.needsCategoryCount > 0 && <p className="mt-5 text-center text-xs text-muted-foreground">{props.overview.needsCategoryCount} items are awaiting a stage.</p>}
        <div className="mt-4 border-t border-foreground/[0.09] pt-9">
          <header className="border-b border-foreground/[0.09] pb-8"><p className="font-mono text-[9px] uppercase tracking-[0.22em] text-muted-foreground">Selected category</p><div className="mt-3 flex flex-wrap items-end justify-between gap-3"><h3 className="font-serif text-5xl tracking-tight">{categoryLabel(selected)}</h3>{category.score != null && <DesignBadge label={`${category.score} / 100`} color="purple" size="md" />}</div></header>
          <section className="py-8">
            <DesignCategoryTabs
              categories={[
                { id: "suggestions", label: "Suggestions", count: suggestions.length },
                { id: "notes", label: "Notes", count: notes.length },
              ]}
              selectedCategory={lane}
              onSelect={(value) => {
                if (value !== "suggestions" && value !== "notes") throw new Error(`Unknown Growth workspace lane: ${value}`);
                setLane(value);
              }}
              size="sm"
              gradient="blue"
              glassmorphic={false}
            />
            <div className="mt-5 border-y border-foreground/[0.08]">
              {lane === "suggestions" && (suggestions.length === 0
                ? <p className="py-8 text-sm text-muted-foreground">No suggestions in this category yet.</p>
                : suggestions.slice(0, 6).map((item) => <SuggestionRow key={`${item.kind}-${item.value.id}`} item={item} projectId={props.projectId} />))}
              {lane === "notes" && (notes.length === 0
                ? <p className="py-8 text-sm text-muted-foreground">No notes in this category yet.</p>
                : notes.map((note) => <SuggestionRow key={note.id} item={{ kind: "finding", value: note }} projectId={props.projectId} />))}
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}

export function GrowthWorkspaceOverview(props: { status: GrowthStatus }) {
  const app = useAdminApp();
  const project = app.useProject();
  const projectId = useProjectId();
  const { demo } = useGrowthStatus();
  const [data, setData] = useState<Loadable>(() => demo ? { status: "loaded", value: buildGrowthDemoOverview(GROWTH_DEMO_NOW_MILLIS) } : { status: "loading" });
  const refresh = useCallback(async () => {
    if (demo) {
      setData({ status: "loaded", value: buildGrowthDemoOverview(GROWTH_DEMO_NOW_MILLIS) });
      return;
    }
    try {
      setData({ status: "loaded", value: await getGrowthOverview(app) });
    } catch (error) {
      captureError("growth-overview-load", error);
      setData({ status: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }, [app, demo]);
  useEffect(() => {
    if (!demo) setData({ status: "loading" });
    runAsynchronously(refresh());
  }, [demo, refresh]);
  if (data.status === "loading") return <div className="space-y-8" aria-busy="true"><div className="h-72 animate-pulse rounded-2xl border bg-foreground/[0.03]" /><div className="h-[42rem] animate-pulse rounded-2xl border bg-foreground/[0.03]" /></div>;
  if (data.status === "error") return <DesignAlert variant="error"><div className="flex flex-wrap items-center justify-between gap-3"><span>Could not load the Growth overview: {data.message}</span><DesignButton size="sm" variant="outline" onClick={refresh}>Retry</DesignButton></div></DesignAlert>;
  return (
    <GrowthWorkspaceContent
      overview={data.value}
      status={props.status}
      projectId={projectId}
      projectName={project.displayName}
      quizBanner={<GrowthQuizBannerSlot demo={demo} />}
    />
  );
}

/**
 * The published-quiz banner and the dialog it opens.
 *
 * Its own component with its own fetch so a quiz outage can never take the workspace down with it:
 * on any failure it renders nothing, which is the same thing it renders when no quiz is published —
 * and that is the honest outcome, because a broken banner offers the customer nothing to act on.
 * The real error is still reported through captureError.
 */
function GrowthQuizBannerSlot(props: { demo: boolean }) {
  const app = useAdminApp();
  const [published, setPublished] = useState<GrowthPublishedQuiz | null>(null);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(async () => {
    if (props.demo) {
      setPublished(buildGrowthDemoPublishedQuiz());
      return;
    }
    try {
      setPublished(await getGrowthPublishedQuiz(app));
    } catch (error) {
      captureError("growth-quiz-banner-load", error);
      setPublished(null);
    }
  }, [app, props.demo]);

  useEffect(() => {
    runAsynchronously(refresh());
  }, [refresh]);

  if (published?.game == null) return null;

  return (
    <>
      <QuizBanner published={published} onPlay={() => setOpen(true)} />
      <QuizDialog
        open={open}
        demo={props.demo}
        onOpenChange={(next) => {
          setOpen(next);
          // Re-read on close so the banner reflects progress made inside the dialog.
          if (!next) runAsynchronously(refresh());
        }}
        onRoundChanged={() => runAsynchronously(refresh())}
      />
    </>
  );
}
