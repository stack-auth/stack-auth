"use client";

import { DesignBadge, DesignButton } from "@/components/design-components";
import { Link } from "@/components/link";
import { cn } from "@/components/ui";
import { useGtmData } from "@/lib/gtm/gtm-data";
import { getGtmSuggestionHref } from "@/lib/gtm/gtm-mode";
import {
  classifyAction,
  classifyInsight,
  classifyNote,
  type GtmAction,
  type GtmDomainId,
  type GtmInsight,
} from "@/lib/gtm/gtm-types";
import { throwErr } from "@hexclave/shared/dist/utils/errors";
import { urlString } from "@hexclave/shared/dist/utils/urls";
import { ArrowRightIcon, PencilSimpleIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { type GtmAdminControls, useOptionalGtmAdminControls } from "./admin-context";
import { GTM_DOMAIN_PRESENTATIONS } from "./domains";
import { GtmLoadableSection } from "./shared";

const DOMAIN_POSITIONS = [
  "left-1/2 top-[16.5%]",
  "left-[79%] top-1/3",
  "left-[79%] top-2/3",
  "left-[21%] top-2/3",
  "left-[21%] top-1/3",
  "left-1/2 top-[83.5%]",
];
const RADAR_ORDER: GtmDomainId[] = ["product", "users", "ads", "revenue", "outreach", "content"];
type Suggestion =
  | { type: "insight", value: GtmInsight }
  | { type: "action", value: GtmAction };

function radarPolygon(radar: Map<GtmDomainId, number> | null): string | null {
  if (radar == null) return null;
  return RADAR_ORDER.map((domain, index) => {
    const angle = (-90 + index * 60) * Math.PI / 180;
    const radius = 150 * (radar.get(domain) ?? 0) / 100;
    return `${(200 + Math.cos(angle) * radius).toFixed(1)},${(200 + Math.sin(angle) * radius).toFixed(1)}`;
  }).join(" ");
}

function DomainTimeline(props: {
  items: Suggestion[],
  admin: GtmAdminControls | null,
  projectId: string,
  demo: boolean,
}) {
  if (props.items.length === 0) {
    return (
      <div className="py-8">
        <p className="text-sm text-muted-foreground">No suggestions yet.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {props.items.slice(0, 4).map((item) => {
        const admin = props.admin;
        const suggestionType = item.type === "insight" ? "insights" : "actions";
        const timelineHref = admin != null
          ? urlString`/projects/internal/gtm/admin/${props.projectId}/${suggestionType}/${item.value.id}`
          : getGtmSuggestionHref(props.projectId, suggestionType, item.value.id, props.demo);
        const card = (
          <article
            className={cn(
              "flex min-h-40 flex-col rounded-xl border border-foreground/[0.09] bg-background p-5",
              admin != null && "pr-14",
              timelineHref != null && "transition-colors duration-150 hover:border-foreground/25 hover:bg-foreground/[0.018] hover:transition-none",
            )}
          >
            <div className="flex items-center justify-between gap-3 font-mono text-[8px] uppercase tracking-[0.16em] text-muted-foreground">
              <span>{item.type === "insight" ? "Growth signal" : "Action"}</span>
              <time>{new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(item.value.createdAtMillis)}</time>
            </div>
            <h5 className="mt-5 line-clamp-3 text-base font-semibold leading-6 tracking-tight text-foreground">{item.value.title}</h5>
            <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground">
              {item.type === "insight" ? item.value.body : item.value.summary}
            </p>
            <div className="mt-auto flex justify-end pt-5">
              {timelineHref != null ? (
                <span className="flex items-center gap-1.5 font-mono text-[8px] uppercase tracking-[0.16em] text-muted-foreground">
                  Open timeline
                  <ArrowRightIcon className="h-3.5 w-3.5" />
                </span>
              ) : item.type === "action" ? (
                <span className="font-mono text-[8px] uppercase tracking-[0.16em] text-muted-foreground">
                  {item.value.status.replaceAll("_", " ")}
                </span>
              ) : null}
            </div>
          </article>
        );
        const timelineLink = timelineHref != null ? (
          <Link
            href={timelineHref}
            aria-label={`Open timeline for ${item.value.title}`}
            className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/30"
          >
            {card}
          </Link>
        ) : card;
        return admin == null ? (
          <div key={`${item.type}-${item.value.id}`}>{timelineLink}</div>
        ) : (
          <div key={`${item.type}-${item.value.id}`} className="relative">
            {timelineLink}
            <DesignButton
              variant="plain"
              size="icon"
              className="absolute right-3 top-3 z-10"
              aria-label={`Edit ${item.value.title}`}
              onClick={() => item.type === "insight"
                ? admin.editInsight(item.value)
                : admin.editAction(item.value)}
            >
              <PencilSimpleIcon className="h-4 w-4" />
            </DesignButton>
          </div>
        );
      })}
    </div>
  );
}

export function DomainWorkspace(props: { projectId: string, projectName: string }) {
  const { data, demo } = useGtmData();
  const admin = useOptionalGtmAdminControls();
  const [selected, setSelected] = useState<GtmDomainId>("users");

  return (
    <GtmLoadableSection data={data}>
      {(dataset) => {
        const suggestions: Suggestion[] = [
          ...dataset.insights.map((value): Suggestion => ({ type: "insight", value })),
          ...dataset.actions
            .filter((item) => ["proposed", "approved", "executing"].includes(item.status))
            .map((value): Suggestion => ({ type: "action", value })),
        ];
        const selectedSuggestions = suggestions
          .filter((item) =>
            item.type === "insight"
              ? classifyInsight(item.value) === selected
              : classifyAction(item.value) === selected
          )
          .sort((left, right) => right.value.createdAtMillis - left.value.createdAtMillis);
        const selectedNotes = dataset.notes.filter((note) => classifyNote(note) === selected);
        const archived = dataset.actions.filter((action) =>
          !["proposed", "approved", "executing"].includes(action.status)
          && classifyAction(action) === selected
        );
        const counts = new Map<GtmDomainId, number>(
          GTM_DOMAIN_PRESENTATIONS.map((domain) => [
            domain.id,
            suggestions.filter((item) =>
              item.type === "insight"
                ? classifyInsight(item.value) === domain.id
                : classifyAction(item.value) === domain.id
            ).length,
          ]),
        );
        const polygon = radarPolygon(dataset.radar);
        const current = GTM_DOMAIN_PRESENTATIONS.find((domain) => domain.id === selected)
          ?? throwErr(`The selected GTM domain is not configured: ${selected}`);

        return (
          <section className="rounded-2xl border border-foreground/[0.08] bg-background px-5 pb-8 pt-10 sm:px-8 lg:px-12">
            <header className="mx-auto max-w-2xl text-center">
              <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
                Your product, seen whole
              </p>
              <h2 className="mt-3 text-balance font-serif text-4xl leading-none tracking-tight sm:text-5xl">
                Insights for every part of your growth.
              </h2>
              <p className="mx-auto mt-4 text-sm text-muted-foreground">Choose a domain to focus the workspace.</p>
            </header>

            <div className="relative mx-auto mt-6 aspect-square w-full max-w-[29rem]">
              <svg viewBox="0 0 400 400" className="absolute inset-[13%] h-[74%] w-[74%]" aria-hidden="true">
                <polygon
                  points="200,20 356,110 356,290 200,380 44,290 44,110"
                  fill="hsl(var(--foreground) / 0.025)"
                  stroke="hsl(var(--foreground) / 0.14)"
                />
                <polygon
                  points="200,72 311,136 311,264 200,328 89,264 89,136"
                  fill="none"
                  stroke="hsl(var(--foreground) / 0.08)"
                />
                {polygon != null && (
                  <polygon
                    points={polygon}
                    fill="hsl(var(--foreground) / 0.13)"
                    stroke="hsl(var(--foreground) / 0.72)"
                    strokeWidth="2"
                  />
                )}
              </svg>
              <div className="pointer-events-none absolute left-1/2 top-1/2 w-32 -translate-x-1/2 -translate-y-1/2 text-center">
                <p className="line-clamp-2 font-serif text-xl leading-none">{props.projectName}</p>
              </div>
              {GTM_DOMAIN_PRESENTATIONS.map((domain, index) => {
                const Icon = domain.icon;
                const score = dataset.radar?.get(domain.id);
                const signalCount = counts.get(domain.id) ?? 0;
                return (
                  <button
                    key={domain.id}
                    type="button"
                    onClick={() => setSelected(domain.id)}
                    className={cn(
                      "absolute min-w-[6.75rem] -translate-x-1/2 -translate-y-1/2 rounded-xl border px-3 py-2 text-left shadow-sm transition-colors duration-150 hover:transition-none focus-visible:outline-none focus-visible:ring-2",
                      DOMAIN_POSITIONS[index],
                      selected === domain.id
                        ? "border-foreground bg-foreground text-background"
                        : "border-foreground/[0.1] bg-background/95",
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <Icon className="h-4 w-4" />
                      <span>
                        <span className="block text-xs font-semibold">{domain.label}</span>
                        {(score != null || signalCount > 0) && (
                          <span className="block font-mono text-[8px] uppercase tracking-[0.12em] opacity-65">
                            {score != null && `${score}${signalCount > 0 ? " · " : ""}`}
                            {signalCount > 0 && `${signalCount} ${signalCount === 1 ? "signal" : "signals"}`}
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="mt-4 border-t border-foreground/[0.09] pt-9">
              <header className="border-b border-foreground/[0.09] pb-8">
                <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-muted-foreground">Selected domain</p>
                <h3 className="mt-3 font-serif text-5xl tracking-tight">{current.label}</h3>
              </header>

              <section className="py-9">
                <h4 className="mb-5 font-serif text-3xl">Suggestions</h4>
                <DomainTimeline
                  items={selectedSuggestions}
                  admin={admin}
                  projectId={props.projectId}
                  demo={demo}
                />
              </section>

              <section className="py-9">
                <h4 className="mb-5 font-serif text-3xl">Notes</h4>
                {selectedNotes.length === 0
                  ? <p className="py-8 text-sm text-muted-foreground">No notes yet.</p>
                  : (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {selectedNotes.map((note) => (
                        <article key={note.id} className="min-h-32 rounded-xl border p-5">
                          <div className="flex items-start justify-between gap-3">
                            <h5 className="text-base font-semibold leading-6 tracking-tight">
                              {note.title ?? "Untitled note"}
                            </h5>
                            {admin != null && (
                              <DesignButton
                                variant="plain"
                                size="icon"
                                aria-label="Edit note"
                                onClick={() => admin.editNote(note)}
                              >
                                <PencilSimpleIcon className="h-4 w-4" />
                              </DesignButton>
                            )}
                          </div>
                          <p className="mt-3 text-sm leading-6 text-muted-foreground">{note.body}</p>
                        </article>
                      ))}
                    </div>
                  )}
              </section>

              <section className="py-9">
                <h4 className="mb-5 font-serif text-3xl">Archive</h4>
                {archived.length === 0
                  ? <p className="py-8 text-sm text-muted-foreground">No archive yet.</p>
                  : (
                    <div className="border-y">
                      {archived.map((item) => (
                        <article
                          key={item.id}
                          className="grid gap-3 border-b py-5 last:border-0 sm:grid-cols-[7rem_1fr_auto]"
                        >
                          <time className="text-xs text-muted-foreground">
                            {new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" })
                              .format(item.executedAtMillis ?? item.createdAtMillis)}
                          </time>
                          <div>
                            <h5 className="text-sm font-semibold">{item.title}</h5>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {item.retrospective ?? item.summary}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <DesignBadge
                              size="sm"
                              color={item.verdict === "worked" ? "green" : "orange"}
                              label={(item.verdict ?? item.status).replaceAll("_", " ")}
                            />
                            {admin != null && (
                              <DesignButton
                                variant="plain"
                                size="icon"
                                aria-label={`Edit ${item.title}`}
                                onClick={() => admin.editAction(item)}
                              >
                                <PencilSimpleIcon className="h-4 w-4" />
                              </DesignButton>
                            )}
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
              </section>
            </div>
          </section>
        );
      }}
    </GtmLoadableSection>
  );
}
