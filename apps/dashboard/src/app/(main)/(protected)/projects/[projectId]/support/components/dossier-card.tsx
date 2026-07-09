"use client";

import { cn } from "@/components/ui";
import { CaretDownIcon, PlayCircleIcon } from "@phosphor-icons/react";
import type { DemoConversation, DossierField } from "../fixtures";
import { FusedTimeline } from "./fused-timeline";

function Row(props: { label: string, revealed: boolean, children: React.ReactNode }) {
  return (
    <div className={cn("transition-opacity duration-500", props.revealed ? "opacity-100" : "opacity-0")}>
      <div className="text-[10px] text-muted-foreground/50">{props.label}</div>
      <div className="mt-0.5 text-xs leading-relaxed text-foreground/85">{props.children}</div>
    </div>
  );
}

/**
 * The auto-generated customer dossier. Fields fade in as the AI "collects"
 * them during intake playback; static conversations show everything at once.
 */
export function DossierCard(props: {
  conversation: DemoConversation,
  revealedFields: ReadonlySet<DossierField>,
  expanded: boolean,
  onToggle: () => void,
}) {
  const { conversation, revealedFields, expanded } = props;
  const dossier = conversation.dossier;
  const has = (field: DossierField) => revealedFields.has(field);
  const anyRevealed = revealedFields.size > 0;

  return (
    <div className="shrink-0 border-b border-foreground/[0.06]">
      <button
        type="button"
        onClick={props.onToggle}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left"
      >
        <span className="text-[11px] font-medium text-muted-foreground/70">Customer dossier</span>
        {!anyRevealed && (
          <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground/50">
            <span className="h-1 w-1 animate-pulse rounded-full bg-purple-400/60" />
            gathering
          </span>
        )}
        <CaretDownIcon className={cn("ml-auto h-3 w-3 text-muted-foreground/40 transition-transform duration-200", !expanded && "-rotate-90")} />
      </button>

      {expanded && (
        <div className="space-y-3 px-4 pb-4">
          <div className="grid grid-cols-2 gap-x-3 gap-y-3">
            <Row label="User" revealed={has("identity")}>
              <span className="font-mono text-[11px]">{dossier.userId}</span>
              <div className="truncate text-[11px] text-muted-foreground/70">{dossier.email}</div>
            </Row>
            <Row label="Plan" revealed={has("plan")}>
              {dossier.plan}
              <div className="text-[11px] text-muted-foreground/70">customer for {dossier.signedUpAgo}</div>
            </Row>
          </div>

          <Row label="Recent activity" revealed={has("authEvents")}>
            <ul className="space-y-1">
              {dossier.authEvents.map((event) => (
                <li key={event} className="text-[11px] leading-relaxed text-foreground/75">{event}</li>
              ))}
            </ul>
          </Row>

          {dossier.replay && (
            <Row label="Session replay" revealed={has("replay")}>
              <button
                type="button"
                className="group flex w-full items-center gap-2 rounded-lg bg-foreground/[0.03] px-2.5 py-2 text-left transition-colors hover:bg-foreground/[0.05]"
              >
                <PlayCircleIcon className="h-4 w-4 shrink-0 text-foreground/50 transition-colors group-hover:text-foreground/80" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px] text-foreground/85">{dossier.replay.label}</span>
                  <span className="block text-[10px] tabular-nums text-muted-foreground/60">{dossier.replay.id} · {dossier.replay.duration}</span>
                </span>
              </button>
            </Row>
          )}

          <Row label="Past tickets" revealed={has("pastTickets")}>
            {dossier.pastTickets.length === 0 ? (
              <span className="text-[11px] text-muted-foreground/60">None — first time reaching out</span>
            ) : (
              <ul className="space-y-1">
                {dossier.pastTickets.map((ticket) => (
                  <li key={ticket.subject} className="text-[11px] text-foreground/75">
                    {ticket.subject}
                    <span className="text-muted-foreground/55"> · resolved {ticket.resolvedAgo}</span>
                  </li>
                ))}
              </ul>
            )}
          </Row>

          {has("authEvents") && <FusedTimeline entries={conversation.timeline} />}
        </div>
      )}
    </div>
  );
}
