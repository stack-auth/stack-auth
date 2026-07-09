"use client";

import { cn } from "@/components/ui";
import { PlayIcon, SparkleIcon } from "@phosphor-icons/react";
import type { DemoConversation, DemoMessage, DemoSender } from "../fixtures";
import { CustomerAvatar, TypingDots } from "./shared";

function SenderLabel(props: { children: React.ReactNode }) {
  return <span className="text-[10px] text-muted-foreground/60">{props.children}</span>;
}

export function MessageBubble(props: { message: DemoMessage, conversation: DemoConversation }) {
  const { message, conversation } = props;

  if (message.kind === "status") {
    return (
      <div className="flex justify-center px-8 py-1 animate-in fade-in duration-500">
        <p className="max-w-md text-center text-[11px] leading-relaxed text-muted-foreground/60">
          <span className="mr-1.5 rounded bg-foreground/[0.05] px-1 py-px text-[9px] text-muted-foreground/70">Internal</span>
          {message.body}
        </p>
      </div>
    );
  }

  if (message.kind === "devin-video") {
    return (
      <div className="flex justify-center py-1 animate-in fade-in slide-in-from-bottom-1 duration-500">
        <div className="w-full max-w-sm rounded-xl border border-foreground/[0.07] bg-foreground/[0.02] p-3">
          <div className="flex aspect-video items-center justify-center rounded-lg bg-foreground/[0.04]">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-background/80 ring-1 ring-foreground/[0.08]">
              <PlayIcon className="ml-0.5 h-4 w-4 text-foreground/70" weight="fill" />
            </div>
          </div>
          <div className="mt-2.5 flex items-center justify-between">
            <span className="text-xs font-medium text-foreground/90">Devin repro — Safari 26</span>
            <span className="text-[10px] tabular-nums text-muted-foreground/60">0:42</span>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{message.body}</p>
        </div>
      </div>
    );
  }

  const isCustomer = message.sender === "customer";
  const isAi = message.sender === "ai";
  const isAutoReply = message.kind === "auto-reply";

  return (
    <div className={cn("flex items-end gap-2 animate-in fade-in slide-in-from-bottom-1 duration-300", isCustomer ? "justify-start" : "justify-end")}>
      {isCustomer && <CustomerAvatar name={conversation.customer.name} hue={conversation.customer.hue} className="mb-4" />}
      <div className={cn("flex max-w-[min(34rem,85%)] flex-col gap-1", isCustomer ? "items-start" : "items-end")}>
        <div
          className={cn(
            "rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
            isCustomer && "rounded-bl-md bg-foreground/[0.04] text-foreground",
            !isCustomer && !isAi && "rounded-br-md bg-foreground/[0.07] text-foreground",
            isAi && "rounded-br-md border border-purple-500/[0.14] bg-purple-500/[0.04] text-foreground",
          )}
        >
          {message.body}
        </div>
        <div className={cn("flex items-center gap-1.5 px-1", isCustomer ? "flex-row" : "flex-row-reverse")}>
          <SenderLabel>{message.at}</SenderLabel>
          {isAi && (
            <span className="flex items-center gap-1 text-[10px] text-purple-400/80">
              <SparkleIcon className="h-2.5 w-2.5" />
              {isAutoReply ? "AI · auto-replied at 93% confidence" : "AI"}
            </span>
          )}
          {!isCustomer && !isAi && <SenderLabel>You</SenderLabel>}
        </div>
      </div>
    </div>
  );
}

export function TypingBubble(props: { sender: Exclude<DemoSender, "system">, conversation: DemoConversation }) {
  const isCustomer = props.sender === "customer";
  return (
    <div className={cn("flex items-end gap-2 animate-in fade-in duration-300", isCustomer ? "justify-start" : "justify-end")}>
      {isCustomer && <CustomerAvatar name={props.conversation.customer.name} hue={props.conversation.customer.hue} />}
      <div
        className={cn(
          "rounded-2xl px-3.5 py-3",
          isCustomer ? "rounded-bl-md bg-foreground/[0.04]" : "rounded-br-md border border-purple-500/[0.14] bg-purple-500/[0.04]",
        )}
      >
        <TypingDots />
      </div>
    </div>
  );
}
