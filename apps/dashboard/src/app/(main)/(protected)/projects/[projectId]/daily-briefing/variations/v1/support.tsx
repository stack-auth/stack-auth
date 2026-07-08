"use client";

import { cn } from "@/components/ui";
import { CheckIcon, FireIcon, TrendDownIcon, TrendUpIcon } from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { FIRE_TICKET, SUPPORT_THEMES } from "./fixtures";
import { Caption, EDITORIAL_EASE, Hairline, RuledButton, SERIF } from "./primitives";

// 03 · Support digest — AI-clustered themes plus the one fire to put out,
// with a suggested reply the reader can adopt in one click.

function ThemeRow({ theme }: { theme: (typeof SUPPORT_THEMES)[number] }) {
  return (
    <div className="grid grid-cols-[auto_1fr] items-baseline gap-x-5 py-4 sm:grid-cols-[56px_1fr_auto]">
      <span className={cn("text-2xl tabular-nums leading-none text-foreground", SERIF)}>{theme.count}</span>
      <div className="min-w-0">
        <span className="text-[15px] font-medium leading-snug text-foreground">{theme.theme}</span>
        <p className="mt-1 max-w-[58ch] text-sm leading-relaxed text-muted-foreground">{theme.summary}</p>
      </div>
      <span
        className={cn(
          "col-start-2 mt-1 inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.14em] sm:col-start-3 sm:mt-0 sm:self-start",
          theme.deltaPct > 0 && "text-orange-700 dark:text-orange-400",
          theme.deltaPct < 0 && "text-emerald-700 dark:text-emerald-400",
          theme.deltaPct === 0 && "text-foreground/35",
        )}
      >
        {theme.deltaPct > 0 && <TrendUpIcon className="h-3 w-3" weight="bold" />}
        {theme.deltaPct < 0 && <TrendDownIcon className="h-3 w-3" weight="bold" />}
        {theme.deltaPct === 0 ? "flat" : `${theme.deltaPct > 0 ? "+" : ""}${theme.deltaPct}% wk`}
      </span>
    </div>
  );
}

export function SupportChapter() {
  const shouldReduceMotion = useReducedMotion();
  const [replyUsed, setReplyUsed] = useState(false);

  return (
    <div className="flex flex-col gap-10">
      <div>
        <Caption>17 open tickets, clustered into 3 themes</Caption>
        <div className="mt-2 flex flex-col">
          {SUPPORT_THEMES.map((theme, i) => (
            <div key={theme.id}>
              {i > 0 && <Hairline />}
              <ThemeRow theme={theme} />
            </div>
          ))}
        </div>
      </div>

      {/* The fire */}
      <div className="border border-orange-600/25 bg-orange-500/[0.04] p-6 dark:border-orange-400/25 dark:bg-orange-400/[0.05] sm:p-8">
        <div className="flex items-center gap-2">
          <FireIcon className="h-4 w-4 text-orange-700 dark:text-orange-400" weight="fill" />
          <Caption className="text-orange-800/80 dark:text-orange-300/80">
            The one to answer first · {FIRE_TICKET.id} · {FIRE_TICKET.company} — {FIRE_TICKET.plan}
          </Caption>
        </div>
        <blockquote
          className={cn(
            "mt-5 border-l-2 border-orange-600/50 pl-5 text-lg leading-relaxed text-foreground/90 dark:border-orange-400/50 sm:text-xl",
            SERIF,
          )}
        >
          “{FIRE_TICKET.excerpt}”
        </blockquote>
        <div className="mt-2 pl-5 font-mono text-[10px] uppercase tracking-[0.18em] text-foreground/40">
          — {FIRE_TICKET.from}
        </div>

        <p className="mt-6 max-w-[62ch] text-sm leading-relaxed text-muted-foreground">{FIRE_TICKET.aiNote}</p>

        <div className="mt-6 border-t border-orange-600/15 pt-5 dark:border-orange-400/15">
          <Caption>Suggested reply — grounded in 2 replays and the deploy queue</Caption>
          <p className="mt-3 max-w-[68ch] text-sm leading-relaxed text-foreground/80">{FIRE_TICKET.suggestedReply}</p>
          <div className="mt-5">
            {replyUsed ? (
              <motion.span
                initial={shouldReduceMotion ? false : { opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, ease: EDITORIAL_EASE }}
                className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-400"
              >
                <CheckIcon className="h-3.5 w-3.5" weight="bold" />
                Reply queued — sending as you
              </motion.span>
            ) : (
              <RuledButton onClick={() => setReplyUsed(true)}>Use reply</RuledButton>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
