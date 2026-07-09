"use client";

import { cn } from "@/components/ui";
import { ArrowCounterClockwiseIcon, PaperPlaneRightIcon, SparkleIcon } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";
import { CHANNEL_LABELS, DEMO_INCIDENT, type DemoConversation } from "../fixtures";
import type { ConversationPlaybackState, DemoPlayback } from "../use-demo-playback";
import { ConfidenceMeter } from "./confidence-meter";
import { IncidentBanner } from "./incident-banner";
import { MessageBubble, TypingBubble } from "./message-bubble";

function AiStateLine(props: { conversation: DemoConversation, playback: ConversationPlaybackState }) {
  const { conversation, playback } = props;
  if (playback.scriptStatus === "playing") return null;
  if (conversation.aiState !== "standing-by") return null;
  return (
    <div className="flex items-center justify-center gap-1.5 py-2">
      <SparkleIcon className="h-3 w-3 text-purple-400/60" />
      <span className="text-[11px] text-muted-foreground/60">
        AI standing by — this reads as a question for a human
      </span>
    </div>
  );
}

function Composer(props: {
  conversation: DemoConversation,
  playback: ConversationPlaybackState,
  demo: DemoPlayback,
  held: boolean,
}) {
  const { conversation, playback, demo } = props;
  const draftIsFromAi = playback.draft !== "" && (playback.draft === conversation.initialDraft || conversation.script !== undefined);

  const handleSend = () => {
    if (playback.draft.trim().toLowerCase().includes("@devin")) {
      demo.setDraft(conversation.id, "");
      demo.tagDevin(conversation.id);
      return;
    }
    demo.sendAgentReply(conversation.id, playback.draft);
  };

  if (props.held && !playback.repliesReleased) {
    return (
      <div className="shrink-0 px-5 pb-4">
        <div className="flex items-center justify-between rounded-xl bg-foreground/[0.02] px-4 py-3">
          <span className="text-xs text-muted-foreground/70">
            Reply held — this conversation gets the canonical incident answer
          </span>
          <button
            type="button"
            onClick={demo.releaseHeldReplies}
            className="shrink-0 text-xs font-medium text-foreground/70 transition-colors hover:text-foreground"
          >
            Release
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="shrink-0 px-5 pb-4">
      {draftIsFromAi && (
        <div className="mb-1.5 flex items-center gap-1.5 px-1">
          <SparkleIcon className="h-3 w-3 text-purple-400/70" />
          <span className="text-[11px] text-muted-foreground/60">Draft prepared by AI — edit freely before sending</span>
        </div>
      )}
      <div className="flex flex-col rounded-xl border border-foreground/[0.07] bg-background focus-within:border-foreground/[0.14] transition-colors">
        <textarea
          value={playback.draft}
          onChange={(event) => demo.setDraft(conversation.id, event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              handleSend();
            }
          }}
          placeholder={`Reply on ${CHANNEL_LABELS[conversation.channel]}${conversation.devinSuggested ? " — tag @Devin to reproduce" : ""}`}
          rows={playback.draft === "" ? 1 : 3}
          className="max-h-40 w-full resize-none bg-transparent px-3.5 py-2.5 text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/50"
        />
        <div className="flex items-center justify-between px-2.5 pb-2">
          <div className="flex items-center gap-1">
            {conversation.devinSuggested && playback.devinStage === "idle" && (
              <button
                type="button"
                onClick={() => demo.tagDevin(conversation.id)}
                className="rounded-md px-2 py-1 text-[11px] text-muted-foreground/60 transition-colors hover:bg-foreground/[0.04] hover:text-foreground/80"
              >
                @Devin reproduce
              </button>
            )}
            {playback.devinStage === "working" && (
              <span className="flex items-center gap-1.5 px-2 py-1 text-[11px] text-muted-foreground/60">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-foreground/40" />
                Devin is reproducing
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={handleSend}
            disabled={playback.draft.trim() === ""}
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors",
              playback.draft.trim() === ""
                ? "text-muted-foreground/40"
                : "bg-foreground text-background hover:bg-foreground/90",
            )}
          >
            <PaperPlaneRightIcon className="h-3 w-3" />
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

export function ThreadPane(props: {
  conversation: DemoConversation,
  playback: ConversationPlaybackState,
  demo: DemoPlayback,
  headerExtra?: React.ReactNode,
}) {
  const { conversation, playback, demo } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const held = demo.incidentTripped && DEMO_INCIDENT.heldConversationIds.includes(conversation.id);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [playback.messages.length, playback.typing]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-foreground/[0.06] px-5 py-3.5">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold tracking-tight text-foreground">{conversation.subject}</h1>
          <p className="mt-0.5 truncate text-xs text-muted-foreground/70">
            {conversation.customer.name} · {conversation.customer.company} · {CHANNEL_LABELS[conversation.channel]}
          </p>
        </div>
        <ConfidenceMeter value={playback.confidence} className="shrink-0" />
        {conversation.script && (
          <button
            type="button"
            onClick={() => demo.replayScript(conversation.id)}
            title="Replay this demo conversation"
            className="shrink-0 rounded-md p-1.5 text-muted-foreground/50 transition-colors hover:bg-foreground/[0.04] hover:text-foreground/80"
          >
            <ArrowCounterClockwiseIcon className="h-3.5 w-3.5" />
          </button>
        )}
        {props.headerExtra}
      </div>

      {held && <IncidentBanner released={playback.repliesReleased} onRelease={demo.releaseHeldReplies} />}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="mx-auto flex max-w-2xl flex-col gap-3">
          {playback.messages.map((message) => (
            <MessageBubble key={message.id} message={message} conversation={conversation} />
          ))}
          {playback.typing && playback.typing !== "system" && (
            <TypingBubble sender={playback.typing} conversation={conversation} />
          )}
          <AiStateLine conversation={conversation} playback={playback} />
        </div>
      </div>

      <Composer conversation={conversation} playback={playback} demo={demo} held={held} />
    </div>
  );
}
