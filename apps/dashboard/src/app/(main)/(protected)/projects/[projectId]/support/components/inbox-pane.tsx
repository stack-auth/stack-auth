"use client";

import { cn } from "@/components/ui";
import { MagnifyingGlassIcon, SparkleIcon } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { CHANNEL_LABELS, DEMO_INCIDENT, getClusterSize, type DemoChannel, type DemoConversation } from "../fixtures";
import type { ConversationPlaybackState } from "../use-demo-playback";
import { ChannelIcon, CustomerAvatar } from "./shared";

const FILTERABLE_CHANNELS: DemoChannel[] = ["slack", "whatsapp", "imessage", "email", "web", "telegram", "discord", "sms"];

function formatAge(minutesAgo: number): string {
  if (minutesAgo < 60) return `${minutesAgo}m`;
  return `${Math.floor(minutesAgo / 60)}h`;
}

function PriorityDot(props: { priority: DemoConversation["priority"] }) {
  if (props.priority === "normal") return null;
  return (
    <span
      className={cn("h-1.5 w-1.5 shrink-0 rounded-full", props.priority === "urgent" ? "bg-red-500/80" : "bg-amber-500/80")}
      title={props.priority === "urgent" ? "Urgent" : "High priority"}
    />
  );
}

function ConversationRow(props: {
  conversation: DemoConversation,
  playback: ConversationPlaybackState,
  incidentTripped: boolean,
  selected: boolean,
  onSelect: () => void,
}) {
  const { conversation, playback, selected } = props;
  const aiActive = playback.typing === "ai" || (conversation.aiState === "intake" && playback.scriptStatus === "playing");
  const clusterSize = getClusterSize(conversation.clusterId, props.incidentTripped);
  const lastMessage = playback.messages[playback.messages.length - 1] as typeof playback.messages[number] | undefined;
  const preview = lastMessage?.kind === "text" || lastMessage?.kind === "auto-reply" ? lastMessage.body : conversation.preview;

  return (
    <button
      type="button"
      onClick={props.onSelect}
      className={cn(
        "w-full px-4 py-3 text-left transition-colors duration-150 hover:transition-none",
        selected ? "bg-foreground/[0.04]" : "hover:bg-foreground/[0.02]",
      )}
    >
      <div className="flex items-center gap-2.5">
        <CustomerAvatar name={conversation.customer.name} hue={conversation.customer.hue} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className={cn("truncate text-[13px]", conversation.unread ? "font-semibold text-foreground" : "font-medium text-foreground/85")}>
              {conversation.customer.name}
            </span>
            <PriorityDot priority={conversation.priority} />
            <span className="ml-auto flex shrink-0 items-center gap-1.5">
              <ChannelIcon channel={conversation.channel} className="h-3 w-3 text-muted-foreground/50" />
              <span className="text-[10px] tabular-nums text-muted-foreground/50">{formatAge(conversation.minutesAgo)}</span>
            </span>
          </div>
          <p className={cn("mt-0.5 truncate text-xs", conversation.unread ? "text-foreground/75" : "text-muted-foreground/70")}>
            {conversation.subject}
          </p>
        </div>
      </div>
      <div className="mt-1.5 flex items-center gap-2 pl-[38px]">
        <p className="min-w-0 flex-1 truncate text-[11px] leading-relaxed text-muted-foreground/55">
          {preview}
        </p>
        {aiActive && <SparkleIcon className="h-3 w-3 shrink-0 animate-pulse text-purple-400/70" />}
        {clusterSize > 1 && (
          <span className="shrink-0 rounded-full bg-foreground/[0.05] px-1.5 py-px text-[10px] tabular-nums text-muted-foreground/70">
            {clusterSize} similar
          </span>
        )}
      </div>
    </button>
  );
}

export function InboxPane(props: {
  conversations: DemoConversation[],
  playbackFor: (conversationId: string) => ConversationPlaybackState,
  incidentTripped: boolean,
  selectedId: string,
  onSelect: (conversationId: string) => void,
}) {
  const [search, setSearch] = useState("");
  const [channelFilter, setChannelFilter] = useState<DemoChannel | null>(null);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return props.conversations.filter((conversation) => {
      if (channelFilter && conversation.channel !== channelFilter) return false;
      if (query === "") return true;
      return [conversation.customer.name, conversation.customer.company, conversation.subject, conversation.preview]
        .some((field) => field.toLowerCase().includes(query));
    });
  }, [props.conversations, search, channelFilter]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-4 pb-3 pt-4">
        <div className="flex items-center gap-2 rounded-lg bg-foreground/[0.03] px-2.5 py-1.5 focus-within:bg-foreground/[0.05] transition-colors">
          <MagnifyingGlassIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search conversations"
            className="w-full bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground/50"
          />
        </div>
        <div className="mt-2.5 flex items-center gap-0.5 overflow-x-auto">
          <button
            type="button"
            onClick={() => setChannelFilter(null)}
            className={cn(
              "shrink-0 rounded-md px-2 py-1 text-[11px] transition-colors",
              channelFilter === null ? "bg-foreground/[0.06] text-foreground" : "text-muted-foreground/60 hover:text-foreground/80",
            )}
          >
            All
          </button>
          {FILTERABLE_CHANNELS.map((channel) => (
            <button
              key={channel}
              type="button"
              onClick={() => setChannelFilter((prev) => (prev === channel ? null : channel))}
              title={CHANNEL_LABELS[channel]}
              className={cn(
                "shrink-0 rounded-md p-1.5 transition-colors",
                channelFilter === channel ? "bg-foreground/[0.06]" : "hover:bg-foreground/[0.03]",
              )}
            >
              <ChannelIcon channel={channel} className={cn(channelFilter === channel ? "text-foreground/80" : "text-muted-foreground/50")} />
            </button>
          ))}
        </div>
      </div>

      {props.incidentTripped && (
        <div className="mx-4 mb-2 flex shrink-0 items-center gap-2 rounded-lg bg-amber-500/[0.06] px-3 py-2 animate-in fade-in slide-in-from-top-1 duration-500">
          <span className="relative flex h-1.5 w-1.5 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-500/50" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-500/80" />
          </span>
          <span className="min-w-0 truncate text-[11px] text-amber-600/90 dark:text-amber-400/90">
            Incident — {DEMO_INCIDENT.reportCount} reports in {DEMO_INCIDENT.windowMinutes}m
          </span>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs text-muted-foreground/60">
            No conversations match.
          </p>
        ) : (
          <div className="flex flex-col divide-y divide-foreground/[0.04]">
            {filtered.map((conversation) => (
              <ConversationRow
                key={conversation.id}
                conversation={conversation}
                playback={props.playbackFor(conversation.id)}
                incidentTripped={props.incidentTripped}
                selected={conversation.id === props.selectedId}
                onSelect={() => props.onSelect(conversation.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
