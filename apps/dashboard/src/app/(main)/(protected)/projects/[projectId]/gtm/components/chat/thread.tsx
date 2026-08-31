"use client";

import { DesignCard } from "@/components/design-components";
import type { GrowthChatToolCard, GrowthChatTranscriptEntry } from "@/lib/growth/growth-chat";
import { ChatCircleDotsIcon, ClockCountdownIcon, LightbulbIcon, LightningIcon, WarningCircleIcon } from "@phosphor-icons/react";
import type { ElementType } from "react";
import { useEffect, useRef } from "react";
import { GrowthMarkdown } from "../report-sections";

// The three example prompts on the empty state; clicking one fills the composer (it does not send,
// so the customer can still edit before committing).
export const GROWTH_CHAT_SUGGESTIONS = [
  "Why did signups dip last week?",
  "What should I focus on to grow revenue this month?",
  "Set up a weekly check on my activation funnel",
] as const;

const TOOL_CARD_META = new Map<GrowthChatToolCard["kind"], { label: string, icon: ElementType }>([
  ["create-action-item", { label: "Created an action item", icon: LightningIcon }],
  // Legacy: the agent no longer creates scheduled tasks (they became workflows attached to action
  // items), but pre-migration transcripts still carry these parts and must keep rendering.
  ["create-scheduled-task", { label: "Created a background task", icon: ClockCountdownIcon }],
  ["save-finding", { label: "Saved a finding", icon: LightbulbIcon }],
]);

/**
 * Compact "the assistant created X" card for an artifact-creating tool call. Internal artifact
 * detail pages are staff-only, so the customer transcript keeps this card informational.
 */
function ToolCardView(props: { card: GrowthChatToolCard }) {
  const { card } = props;
  const baseMeta = TOOL_CARD_META.get(card.kind)
    // The fold only emits cards for the three known kinds, but keep rendering total if that set grows.
    ?? { label: "Used a tool", icon: LightningIcon };
  // A workflow-bearing action item is a proposed automation awaiting the customer's explicit
  // review-and-activate — say so instead of the generic "created an action item".
  // Errored cards fall back to the generic label so the "Could not create …" rewrite below applies.
  const meta = card.kind === "create-action-item" && card.hasWorkflow && !card.errored
    ? { label: "Proposed automation — review & activate", icon: baseMeta.icon }
    : baseMeta;
  const Icon = meta.icon;
  return (
    <div className="flex max-w-xl flex-wrap items-center gap-2.5 rounded-xl border border-foreground/[0.08] bg-foreground/[0.02] px-3.5 py-2.5">
      {card.errored
        ? <WarningCircleIcon className="size-4 shrink-0 text-destructive" />
        : <Icon className="size-4 shrink-0 text-muted-foreground" />}
      <span className="text-sm text-foreground">
        {card.errored ? `${meta.label.replace("Created", "Could not create").replace("Saved", "Could not save").replace("Used", "Could not use")}` : meta.label}
        {card.label != null && <span className="text-muted-foreground">: {card.label}</span>}
      </span>
    </div>
  );
}

function UserBubble(props: { text: string }) {
  return (
    <div className="ml-auto max-w-md whitespace-pre-wrap rounded-2xl rounded-br-md bg-foreground/[0.06] px-4 py-2.5 text-sm">
      {props.text}
    </div>
  );
}

function TranscriptEntryView(props: { entry: GrowthChatTranscriptEntry }) {
  const { entry } = props;
  switch (entry.type) {
    case "text": {
      return entry.role === "user"
        ? <UserBubble text={entry.text} />
        : <GrowthMarkdown content={entry.text} className="max-w-xl" />;
    }
    case "tool": {
      return <ToolCardView card={entry.card} />;
    }
  }
}

function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-1.5 py-1" role="status" aria-label="The growth assistant is thinking">
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60"
          style={{ animationDelay: `${index * 150}ms` }}
        />
      ))}
    </div>
  );
}

/** The empty state for a fresh chat: what the assistant can do, plus clickable example prompts. */
export function GrowthChatWelcome(props: { onSuggestion: (text: string) => void, disabled: boolean }) {
  return (
    <DesignCard
      title="Ask the growth assistant"
      subtitle="It knows your full growth context — analysis, reports, briefs, actions, and metrics"
      icon={ChatCircleDotsIcon}
      gradient="cyan"
    >
      <div className="flex max-w-xl flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          Ask about your numbers, dig into a report, or have it create action items, automations,
          and findings for you. Some examples to get you started:
        </p>
        <div className="flex flex-wrap gap-2">
          {GROWTH_CHAT_SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              disabled={props.disabled}
              onClick={() => props.onSuggestion(suggestion)}
              className="rounded-full border border-foreground/[0.1] px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:transition-none hover:bg-foreground/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            >
              {suggestion}
            </button>
          ))}
        </div>
      </div>
    </DesignCard>
  );
}

/**
 * The chat transcript: committed entries, then the in-flight turn's entries, then the thinking
 * indicator while a turn streams. Auto-scrolls its bottom anchor into view when content grows —
 * same pattern (and the same first-paint guard) as the interview transcript.
 */
export function GrowthChatThread(props: {
  entries: GrowthChatTranscriptEntry[],
  streamingEntries: GrowthChatTranscriptEntry[],
  thinking: boolean,
}) {
  const bottomAnchorRef = useRef<HTMLDivElement | null>(null);
  const entryCount = props.entries.length + props.streamingEntries.length;
  const initialRenderRef = useRef(true);
  useEffect(() => {
    // Don't yank the page down on first paint — only follow the conversation as it grows.
    if (initialRenderRef.current) {
      initialRenderRef.current = false;
      return;
    }
    bottomAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [entryCount, props.thinking]);

  return (
    <div className="flex flex-col gap-4">
      {[...props.entries, ...props.streamingEntries].map((entry) => (
        <TranscriptEntryView key={entry.id} entry={entry} />
      ))}
      {props.thinking && <ThinkingIndicator />}
      <div ref={bottomAnchorRef} />
    </div>
  );
}
