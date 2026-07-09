"use client";

import { cn } from "@/components/ui";
import {
  AppleLogoIcon,
  ChatTeardropDotsIcon,
  DiscordLogoIcon,
  EnvelopeSimpleIcon,
  GlobeSimpleIcon,
  SlackLogoIcon,
  TelegramLogoIcon,
  WhatsappLogoIcon,
} from "@phosphor-icons/react";
import type { DemoChannel } from "../fixtures";

const CHANNEL_ICONS: Record<DemoChannel, typeof SlackLogoIcon> = {
  slack: SlackLogoIcon,
  whatsapp: WhatsappLogoIcon,
  imessage: AppleLogoIcon,
  telegram: TelegramLogoIcon,
  discord: DiscordLogoIcon,
  email: EnvelopeSimpleIcon,
  web: GlobeSimpleIcon,
  sms: ChatTeardropDotsIcon,
};

export function ChannelIcon(props: { channel: DemoChannel, className?: string }) {
  const Icon = CHANNEL_ICONS[props.channel];
  return <Icon className={cn("h-3.5 w-3.5 text-muted-foreground/70", props.className)} />;
}

export function CustomerAvatar(props: { name: string, hue: number, className?: string }) {
  const initials = props.name
    .split(" ")
    .map((part) => part.slice(0, 1))
    .slice(0, 2)
    .join("");
  return (
    <div
      className={cn("flex h-7 w-7 shrink-0 select-none items-center justify-center rounded-full text-[10px] font-medium", props.className)}
      style={{
        backgroundColor: `hsl(${props.hue} 45% 50% / 0.12)`,
        color: `hsl(${props.hue} 40% 45%)`,
      }}
    >
      {initials}
    </div>
  );
}

export function TypingDots(props: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1", props.className)}>
      <span className="h-1 w-1 animate-pulse rounded-full bg-muted-foreground/60" />
      <span className="h-1 w-1 animate-pulse rounded-full bg-muted-foreground/60" style={{ animationDelay: "150ms" }} />
      <span className="h-1 w-1 animate-pulse rounded-full bg-muted-foreground/60" style={{ animationDelay: "300ms" }} />
    </span>
  );
}

export function PaneHeading(props: { children: React.ReactNode, className?: string }) {
  return (
    <div className={cn("text-[11px] font-medium text-muted-foreground/70", props.className)}>
      {props.children}
    </div>
  );
}
