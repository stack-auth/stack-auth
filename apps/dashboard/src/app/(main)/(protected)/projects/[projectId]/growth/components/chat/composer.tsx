"use client";

import { DesignButton } from "@/components/design-components";
import { Textarea } from "@/components/ui/textarea";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { PaperPlaneTiltIcon } from "@phosphor-icons/react";
import { useState } from "react";

/**
 * The chat composer: a textarea plus send button. Enter sends, Shift+Enter inserts a newline (the
 * standard chat convention). The draft is owned here, but the parent can prefill it (suggestion
 * chips) via `draft`/`onDraftChange` — controlled from the page so the empty state's chips work.
 */
export function GrowthChatComposer(props: {
  draft: string,
  onDraftChange: (value: string) => void,
  onSend: (text: string) => Promise<void>,
  disabled: boolean,
  demo: boolean,
}) {
  const [sending, setSending] = useState(false);
  const canSend = !props.disabled && !sending && props.draft.trim().length > 0;

  const send = async () => {
    if (!canSend) return;
    const text = props.draft;
    // Clear optimistically; a failed turn keeps its text in the turn-error retry affordance, so the
    // composer does not need to restore it.
    props.onDraftChange("");
    setSending(true);
    try {
      await props.onSend(text);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-end gap-2">
        <Textarea
          value={props.draft}
          onChange={(event) => props.onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              // onKeyDown cannot be async; expected failures already surface through the hook's
              // turn state, so runAsynchronously only has to cover truly unexpected errors.
              runAsynchronously(send());
            }
          }}
          placeholder={props.demo ? "Demo mode — sending messages is disabled" : "Ask the growth assistant anything…"}
          rows={2}
          disabled={props.disabled || sending}
          aria-label="Chat message"
          className="min-h-[3.5rem] resize-none"
        />
        <DesignButton
          size="icon"
          aria-label="Send message"
          disabled={!canSend}
          onClick={async () => await send()}
        >
          <PaperPlaneTiltIcon className="size-4" />
        </DesignButton>
      </div>
      {props.demo && (
        <p className="text-xs text-muted-foreground">
          Demo mode — you are looking at a fixture conversation, so the composer is disabled.
        </p>
      )}
    </div>
  );
}
