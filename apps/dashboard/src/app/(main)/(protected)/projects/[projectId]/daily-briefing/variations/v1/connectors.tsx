"use client";

import { cn } from "@/components/ui";
import { CheckIcon, PlusIcon } from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { Caption, EDITORIAL_EASE, GhostAction, Hairline } from "./primitives";

// MCP connectors: each connected server contributes its own chapter to the
// brief. All mock — "connecting" is a short piece of theater.

export type ConnectorRow = {
  id: string,
  text: string,
  meta: string,
  action?: string,
};

export type Connector = {
  id: string,
  label: string,
  domain: string,
  // Shown in the manager list.
  summary: string,
  // Chapter copy once connected.
  chapterTitle: string,
  chapterBlurb: string,
  caption: string,
  rows: ConnectorRow[],
};

export const CONNECTORS: Connector[] = [
  {
    id: "slack",
    label: "Slack",
    domain: "slack.com",
    summary: "Mentions, hot threads, and unanswered questions from your channels",
    chapterTitle: "From Slack",
    chapterBlurb: "The three threads worth opening before standup.",
    caption: "MCP · slack — 4 channels watched overnight",
    rows: [
      {
        id: "sl-support",
        text: "#support is running hot: 14 replies on the webhook-signature thread — same root cause as chapter 03.",
        meta: "#support · 02:58",
        action: "Open thread",
      },
      {
        id: "sl-mention",
        text: "Priya mentioned you in #eng-auth: wants a decision on the OAuth fallback rollout order.",
        meta: "#eng-auth · 07:04",
        action: "Reply with briefing context",
      },
      {
        id: "sl-general",
        text: "Your CEO asked in #general how activation is trending. Chapter 02 has the answer — a draft reply is ready.",
        meta: "#general · 06:47",
        action: "Use draft",
      },
    ],
  },
  {
    id: "google-workspace",
    label: "Google Workspace",
    domain: "workspace.google.com",
    summary: "Calendar dossiers and the inbox threads that actually matter",
    chapterTitle: "From Google Workspace",
    chapterBlurb: "Your 2pm needs ten minutes of prep; two threads need none.",
    caption: "MCP · google-workspace — calendar + gmail scanned at 06:10",
    rows: [
      {
        id: "gw-renewal",
        text: "Acme Corp renewal call at 14:00 — dossier ready: usage trend, the Enterprise upgrade, and last night's incident impact (none).",
        meta: "Calendar · today 14:00",
        action: "Open dossier",
      },
      {
        id: "gw-maya",
        text: "Maya from Rocketry replied on the launch thread 40 minutes after filing ticket #4491 — tone is salvageable if the fix ships today.",
        meta: "Gmail · 22:19",
        action: "Read thread",
      },
      {
        id: "gw-soc2",
        text: "Your SOC 2 auditor shared the evidence-request sheet — 3 items are already covered by chapter 05's scan results.",
        meta: "Drive · yesterday",
        action: "Pre-fill from briefing",
      },
    ],
  },
  {
    id: "github",
    label: "GitHub",
    domain: "github.com",
    summary: "PRs waiting on you and the ones that fix today's problems",
    chapterTitle: "From GitHub",
    chapterBlurb: "Two reviews unblock other people; one PR closes the incident.",
    caption: "MCP · github — 3 repos watched",
    rows: [
      {
        id: "gh-fallback",
        text: "PR #812 'OAuth redirect fallback for iOS Safari' is green and waiting — it's the fix chapter 11 wants shipped by noon.",
        meta: "acme/auth · CI passed 06:32",
        action: "Review & merge",
      },
      {
        id: "gh-leak",
        text: "Draft PR #815 patches the ingest-worker pool leak from chapter 08 — the briefing staged it from the incident trace.",
        meta: "acme/ingest · draft",
        action: "Open draft",
      },
      {
        id: "gh-reviews",
        text: "2 teammate PRs have waited 20+ hours on your review — both under 80 lines.",
        meta: "acme/dashboard",
        action: "Start reviews",
      },
    ],
  },
  {
    id: "linear",
    label: "Linear",
    domain: "linear.app",
    summary: "Issue movement, stale blockers, and cycle health",
    chapterTitle: "From Linear",
    chapterBlurb: "The cycle is healthy except for one blocker nobody owns.",
    caption: "MCP · linear — cycle 14, day 6 of 10",
    rows: [
      {
        id: "ln-blocker",
        text: "AUTH-231 'webhook docs rewrite' blocks 3 issues and has no assignee — it's also the fix for chapter 03's ticket cluster.",
        meta: "Cycle 14 · blocker",
        action: "Assign",
      },
      {
        id: "ln-velocity",
        text: "Cycle velocity is on track: 61% complete on day 6, with QA the only column trending late.",
        meta: "Cycle 14",
      },
    ],
  },
  {
    id: "stripe",
    label: "Stripe",
    domain: "stripe.com",
    summary: "Failed payments, dunning, and revenue events worth a human",
    chapterTitle: "From Stripe",
    chapterBlurb: "Two cards need a nudge before they become churn.",
    caption: "MCP · stripe — dunning queue checked 06:05",
    rows: [
      {
        id: "st-dunning",
        text: "2 subscriptions enter final dunning retry tomorrow ($698/mo combined) — a payment-update nudge is drafted for both.",
        meta: "Dunning · retry 3 of 3",
        action: "Send nudges",
      },
      {
        id: "st-upgrade",
        text: "Acme Corp's Enterprise invoice cleared overnight — the upgrade behind yesterday's revenue annotation is fully paid.",
        meta: "Invoice #4821 · paid 03:40",
      },
    ],
  },
];

export function connectorFaviconUrl(domain: string) {
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
}

// One connected server's chapter body: caption + ruled rows with actions.
export function ConnectorChapterContent({ connector }: { connector: Connector }) {
  return (
    <div className="flex flex-col">
      <Caption className="pb-2">{connector.caption}</Caption>
      {connector.rows.map((row, i) => (
        <div key={row.id}>
          {i > 0 && <Hairline />}
          <div className="py-4">
            <p className="max-w-[64ch] text-[15px] leading-relaxed text-foreground/90">{row.text}</p>
            <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-foreground/35">{row.meta}</span>
              {row.action != null && <GhostAction>{row.action}</GhostAction>}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// The manager chapter: connected servers with their favicons, plus the rest of
// the catalog one click away. Connecting plays a brief handshake.
export function ConnectorsManager({
  connected,
  onToggle,
}: {
  connected: Set<string>,
  onToggle: (id: string) => void,
}) {
  const shouldReduceMotion = useReducedMotion();
  const [connecting, setConnecting] = useState<string | null>(null);

  const connect = (id: string) => {
    setConnecting(id);
    setTimeout(() => {
      setConnecting(null);
      onToggle(id);
    }, shouldReduceMotion ? 0 : 900);
  };

  return (
    <div className="flex flex-col">
      <Caption className="pb-2">
        Each connected MCP server writes its own chapter into tomorrow&apos;s brief
      </Caption>
      {CONNECTORS.map((connector, i) => {
        const isConnected = connected.has(connector.id);
        const isConnecting = connecting === connector.id;
        return (
          <div key={connector.id}>
            {i > 0 && <Hairline />}
            <div className="flex items-center gap-4 py-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={connectorFaviconUrl(connector.domain)}
                alt=""
                className={cn("h-6 w-6 shrink-0 rounded-sm transition-[filter,opacity]", !isConnected && "opacity-50 grayscale")}
                width={24}
                height={24}
              />
              <div className="min-w-0 flex-1">
                <span className="text-[15px] font-medium leading-snug text-foreground">{connector.label}</span>
                <p className="mt-0.5 max-w-[56ch] text-sm leading-relaxed text-muted-foreground">{connector.summary}</p>
              </div>
              <div className="shrink-0">
                {isConnected ? (
                  <span className="flex flex-col items-end gap-1">
                    <motion.span
                      initial={shouldReduceMotion ? false : { opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3, ease: EDITORIAL_EASE }}
                      className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-400"
                    >
                      <CheckIcon className="h-3.5 w-3.5" weight="bold" />
                      Connected
                    </motion.span>
                    <GhostAction onClick={() => onToggle(connector.id)} className="text-foreground/35">
                      Disconnect
                    </GhostAction>
                  </span>
                ) : isConnecting ? (
                  <span className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-foreground/50">
                    <motion.span
                      className="h-3 w-3 rounded-full border border-foreground/30 border-t-foreground/80"
                      animate={shouldReduceMotion ? undefined : { rotate: 360 }}
                      transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
                    />
                    Authorizing…
                  </span>
                ) : (
                  <GhostAction onClick={() => connect(connector.id)}>
                    <span className="inline-flex items-center gap-1.5">
                      <PlusIcon className="h-3 w-3" weight="bold" />
                      Connect
                    </span>
                  </GhostAction>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
