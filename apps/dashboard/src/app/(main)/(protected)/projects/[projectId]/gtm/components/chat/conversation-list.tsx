"use client";

import { DesignAlert, DesignButton } from "@/components/design-components";
import type { GrowthChatListState } from "@/lib/growth/growth-chat";
import { cn } from "@/lib/utils";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { PlusIcon } from "@phosphor-icons/react";

/**
 * The chat page's conversation history sidebar: a "New chat" button on top of the newest-first
 * conversation list (the backend already orders by updatedAt desc). Selection is lifted to the page
 * so the list stays a pure view over the hook's state.
 */
export function GrowthChatConversationList(props: {
  list: GrowthChatListState,
  activeConversationId: string | null,
  disabled: boolean,
  onSelect: (conversationId: string) => Promise<void>,
  onNewChat: () => void,
  onRetryLoad: () => Promise<void>,
}) {
  return (
    <div className="flex flex-col gap-3">
      <DesignButton
        variant="outline"
        size="sm"
        className="justify-start"
        disabled={props.disabled || props.activeConversationId == null}
        onClick={() => props.onNewChat()}
      >
        <PlusIcon className="mr-1.5 size-4" />
        New chat
      </DesignButton>
      {props.list.status === "loading" && (
        <div className="flex flex-col gap-1.5" aria-busy="true" aria-label="Loading conversations">
          {[0, 1, 2].map((index) => (
            <div key={index} className="h-9 animate-pulse rounded-lg bg-foreground/[0.03]" />
          ))}
        </div>
      )}
      {props.list.status === "error" && (
        <DesignAlert variant="error">
          <div className="flex flex-col items-start gap-2">
            <span>Could not load your conversations: {props.list.message}</span>
            <DesignButton variant="outline" size="sm" onClick={async () => await props.onRetryLoad()}>Retry</DesignButton>
          </div>
        </DesignAlert>
      )}
      {props.list.status === "loaded" && (
        props.list.conversations.length === 0 ? (
          <p className="px-2 text-xs text-muted-foreground">No conversations yet — your chats will appear here.</p>
        ) : (
          <nav className="flex flex-col gap-0.5" aria-label="Conversation history">
            {props.list.conversations.map((conversation) => {
              const active = conversation.id === props.activeConversationId;
              return (
                <button
                  key={conversation.id}
                  type="button"
                  disabled={props.disabled}
                  aria-current={active ? "true" : undefined}
                  onClick={() => {
                    // A raw <button> (unlike DesignButton) has no async onClick support; onSelect
                    // routes its own failures into the hook's thread error state, so nothing here
                    // can reject unexpectedly.
                    if (!active) runAsynchronously(props.onSelect(conversation.id));
                  }}
                  className={cn(
                    "truncate rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
                    active ? "bg-foreground/[0.06] font-medium text-foreground" : "text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground",
                  )}
                >
                  {conversation.title ?? "Untitled chat"}
                </button>
              );
            })}
          </nav>
        )
      )}
    </div>
  );
}
