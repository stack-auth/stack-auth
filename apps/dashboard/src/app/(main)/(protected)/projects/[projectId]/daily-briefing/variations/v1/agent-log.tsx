"use client";

import { cn } from "@/components/ui";
import {
  ArrowCounterClockwiseIcon,
  CheckIcon,
  EnvelopeSimpleIcon,
  KeyIcon,
  PlugsConnectedIcon,
  SparkleIcon,
} from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { fmtTime } from "../../mock-data";
import { AGENT_ACTIONS, AUTOMATION_SUGGESTIONS, type AgentAction } from "./fixtures";
import { Caption, EDITORIAL_EASE, GhostAction, Hairline } from "./primitives";

// 01 · While you slept — a ledger of actions the agent already took, each with
// approve/undo affordances. Editorial: a ruled list, not cards.

const KIND_ICON: Record<AgentAction["kind"], typeof CheckIcon> = {
  webhook: PlugsConnectedIcon,
  email: EnvelopeSimpleIcon,
  anomaly: SparkleIcon,
  housekeeping: KeyIcon,
};

type RowState = "pending" | "approved" | "undone";

// Coding agents that can execute an approved suggestion. Favicons are pulled
// live so they're always the real logos.
type Runner = {
  id: string,
  label: string,
  domain: string,
  note: string,
};

const RUNNERS: Runner[] = [
  { id: "claude-code", label: "Claude Code", domain: "claude.ai", note: "runs in your repo via the CLI" },
  { id: "codex", label: "Codex", domain: "openai.com", note: "opens a cloud task with the diff" },
  { id: "cursor", label: "Cursor", domain: "cursor.com", note: "hands off to a background agent" },
];

function faviconUrl(domain: string) {
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
}

// "Run with…" picker shown after Approve & run. Pure theater — picking a
// runner just marks the row approved with the runner's name.
function RunWithDialog({
  actionTitle,
  onPick,
  onClose,
}: {
  actionTitle: string,
  onPick: (runner: Runner) => void,
  onClose: () => void,
}) {
  const shouldReduceMotion = useReducedMotion();
  // Portaled to <body>: the chapter's reveal animation leaves transforms on
  // ancestors, which would otherwise re-anchor this fixed overlay.
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-6">
      <motion.div
        initial={shouldReduceMotion ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={shouldReduceMotion ? undefined : { opacity: 0 }}
        className="absolute inset-0 bg-black/30 backdrop-blur-[2px] dark:bg-black/50"
        onClick={onClose}
      />
      <motion.div
        initial={shouldReduceMotion ? false : { opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={shouldReduceMotion ? undefined : { opacity: 0, y: 8, scale: 0.98 }}
        transition={{ duration: 0.3, ease: EDITORIAL_EASE }}
        className="relative w-full max-w-md border border-black/[0.12] bg-white p-7 shadow-[0_24px_60px_rgba(15,23,42,0.25)] dark:border-white/[0.14] dark:bg-background"
      >
        <Caption>Run this with</Caption>
        <p className="mt-2 text-[15px] font-medium leading-snug text-foreground">{actionTitle}</p>
        <div className="mt-5 flex flex-col">
          {RUNNERS.map((runner, i) => (
            <div key={runner.id}>
              {i > 0 && <Hairline />}
              <button
                type="button"
                onClick={() => onPick(runner)}
                className="group flex w-full items-center gap-4 py-3.5 text-left"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={faviconUrl(runner.domain)}
                  alt=""
                  className="h-6 w-6 shrink-0 rounded-sm"
                  width={24}
                  height={24}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-foreground group-hover:underline group-hover:decoration-foreground/40 group-hover:underline-offset-4">
                    {runner.label}
                  </span>
                  <span className="block text-xs text-muted-foreground">{runner.note}</span>
                </span>
                <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-foreground/30 transition-colors group-hover:text-foreground/60">
                  Run
                </span>
              </button>
            </div>
          ))}
        </div>
        <div className="mt-4 border-t border-black/[0.07] pt-4 dark:border-white/[0.08]">
          <GhostAction onClick={onClose} className="text-foreground/40">
            Cancel
          </GhostAction>
        </div>
      </motion.div>
    </div>,
    document.body,
  );
}

export function AgentLogChapter() {
  const shouldReduceMotion = useReducedMotion();
  const [states, setStates] = useState<Record<string, RowState>>({});
  const [runners, setRunners] = useState<Record<string, string>>({});
  const [dialogFor, setDialogFor] = useState<string | null>(null);

  const setRow = (id: string, state: RowState) => {
    setStates((prev) => ({ ...prev, [id]: state }));
  };

  const dialogAction = AGENT_ACTIONS.find((a) => a.id === dialogFor);

  return (
    <div className="flex flex-col">
      <Caption className="pb-4">Four suggestions prepared between 02:12 and 04:39 — nothing runs without you</Caption>
      {AGENT_ACTIONS.map((action, i) => {
        const Icon = KIND_ICON[action.kind];
        const state = states[action.id] ?? "pending";
        return (
          <div key={action.id}>
            {i > 0 && <Hairline />}
            <div
              className={cn(
                "grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 py-5 transition-opacity duration-300 sm:grid-cols-[64px_auto_1fr]",
                state === "undone" && "opacity-45",
              )}
            >
              <span className="hidden pt-0.5 font-mono text-xs tabular-nums text-foreground/40 sm:block">
                {fmtTime(action.atMs)}
              </span>
              <Icon className="mt-0.5 h-4 w-4 text-foreground/50" weight="regular" />
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-[15px] font-medium leading-snug text-foreground">
                    {state === "undone" ? <s className="decoration-foreground/40">{action.title}</s> : action.title}
                  </span>
                  <span className="font-mono text-[10px] tabular-nums tracking-[0.14em] text-foreground/35 sm:hidden">
                    {fmtTime(action.atMs)}
                  </span>
                </div>
                <p className="mt-1 max-w-[62ch] text-sm leading-relaxed text-muted-foreground">{action.detail}</p>
                <div className="mt-3 flex items-center gap-5">
                  <AnimatePresence mode="wait" initial={false}>
                    {state === "pending" && (
                      <motion.div
                        key="pending"
                        className="flex items-center gap-5"
                        exit={shouldReduceMotion ? undefined : { opacity: 0, y: -4 }}
                        transition={{ duration: 0.25, ease: EDITORIAL_EASE }}
                      >
                        <GhostAction onClick={() => setDialogFor(action.id)}>Approve &amp; run</GhostAction>
                        <GhostAction onClick={() => setRow(action.id, "undone")} className="text-foreground/40">
                          Dismiss
                        </GhostAction>
                      </motion.div>
                    )}
                    {state === "approved" && (
                      <motion.span
                        key="approved"
                        initial={shouldReduceMotion ? false : { opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3, ease: EDITORIAL_EASE }}
                        className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-400"
                      >
                        <CheckIcon className="h-3.5 w-3.5" weight="bold" />
                        Approved — running via {runners[action.id] ?? "Claude Code"}
                      </motion.span>
                    )}
                    {state === "undone" && (
                      <motion.span
                        key="undone"
                        initial={shouldReduceMotion ? false : { opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3, ease: EDITORIAL_EASE }}
                        className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-foreground/50"
                      >
                        <ArrowCounterClockwiseIcon className="h-3.5 w-3.5" weight="bold" />
                        Dismissed
                      </motion.span>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </div>
          </div>
        );
      })}

      <AnimatePresence>
        {dialogAction != null && (
          <RunWithDialog
            key="run-with"
            actionTitle={dialogAction.title}
            onClose={() => setDialogFor(null)}
            onPick={(runner) => {
              setRunners((prev) => ({ ...prev, [dialogAction.id]: runner.label }));
              setRow(dialogAction.id, "approved");
              setDialogFor(null);
            }}
          />
        )}
      </AnimatePresence>

      {/* Suggested automations — opt-in rules derived from tonight's work */}
      <div className="mt-8 border border-black/[0.1] px-6 py-6 dark:border-white/[0.12] sm:px-7">
        <Caption>Suggested automations — turn tonight&apos;s busywork into standing rules</Caption>
        <div className="mt-2 flex flex-col">
          {AUTOMATION_SUGGESTIONS.map((suggestion, i) => (
            <AutomationRow key={suggestion.id} suggestion={suggestion} first={i === 0} />
          ))}
        </div>
      </div>
    </div>
  );
}

function AutomationRow({
  suggestion,
  first,
}: {
  suggestion: (typeof AUTOMATION_SUGGESTIONS)[number],
  first: boolean,
}) {
  const shouldReduceMotion = useReducedMotion();
  const [enabled, setEnabled] = useState(false);
  return (
    <div>
      {!first && <Hairline />}
      <div className="py-4">
        <span className="text-[15px] font-medium leading-snug text-foreground">{suggestion.rule}</span>
        <p className="mt-1 max-w-[60ch] text-sm leading-relaxed text-muted-foreground">{suggestion.rationale}</p>
        <div className="mt-3">
          {enabled ? (
            <motion.span
              initial={shouldReduceMotion ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: EDITORIAL_EASE }}
              className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-400"
            >
              <CheckIcon className="h-3.5 w-3.5" weight="bold" />
              Automation enabled — you can revoke it in settings
            </motion.span>
          ) : (
            <GhostAction onClick={() => setEnabled(true)}>Enable automation</GhostAction>
          )}
        </div>
      </div>
    </div>
  );
}
