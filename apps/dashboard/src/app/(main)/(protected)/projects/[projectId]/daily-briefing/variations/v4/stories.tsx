"use client";

// Interactive story blocks for the BROADSHEET variation: the overnight
// corrections box, the urgent letter, the obituaries, and the classifieds
// with their SENT stamps.

import { cn } from "@/components/ui";
import { ArrowCounterClockwiseIcon, CheckIcon, PaperPlaneTiltIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import {
  CLASSIFIEDS,
  FIRE_TICKET,
  OBITUARIES,
  OVERNIGHT_ACTIONS,
  type ClassifiedAd,
  type Obituary,
  type OvernightAction,
} from "./fixtures";
import { ACCENT, BodyText, INK, MUTED, RULE, RULE_STRONG, SERIF } from "./primitives";

// Small inkwell button, shared by every affordance on the page.
function InkButton({
  children,
  onClick,
  filled,
  className,
}: {
  children: React.ReactNode,
  onClick?: () => void,
  filled?: boolean,
  className?: string,
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 border px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.18em] transition-colors",
        RULE_STRONG,
        filled
          ? "bg-[color:var(--np-ink)] text-[color:var(--np-paper)] hover:opacity-85"
          : cn(INK, "hover:bg-[color:var(--np-ink)] hover:text-[color:var(--np-paper)]"),
        className,
      )}
    >
      {children}
    </button>
  );
}

// ─── Overnight desk (corrections & amplifications box) ────────────────────────

type ActionState = "pending" | "approved" | "undone";

export function OvernightDesk() {
  const [states, setStates] = useState<Record<string, ActionState>>({});

  const set = (id: string, s: ActionState) => setStates((prev) => ({ ...prev, [id]: s }));

  return (
    <div className={cn("border-2 p-3", RULE_STRONG)}>
      <div className={cn("border-b-2 pb-1.5 text-center", RULE_STRONG)}>
        <div className={cn("font-mono text-[10px] font-bold uppercase tracking-[0.28em]", INK)}>Overnight Desk</div>
        <div className={cn("mt-0.5 font-mono text-[8px] uppercase tracking-[0.22em]", MUTED)}>
          What the agent did while you slept
        </div>
      </div>
      <ul className={cn("divide-y", RULE.replace("border-", "divide-"))}>
        {OVERNIGHT_ACTIONS.map((action) => (
          <OvernightRow
            key={action.id}
            action={action}
            state={states[action.id] ?? "pending"}
            onApprove={() => set(action.id, "approved")}
            onUndo={() => set(action.id, "undone")}
          />
        ))}
      </ul>
      <div className={cn("mt-2 border-t pt-1.5 text-center font-mono text-[8px] uppercase tracking-[0.2em]", RULE, MUTED)}>
        Corrections & amplifications welcomed — enquire within
      </div>
    </div>
  );
}

function OvernightRow({
  action,
  state,
  onApprove,
  onUndo,
}: {
  action: OvernightAction,
  state: ActionState,
  onApprove: () => void,
  onUndo: () => void,
}) {
  return (
    <li className="py-2.5">
      <div className="flex items-baseline gap-2">
        <span className={cn("font-mono text-[9px] font-bold tracking-[0.12em]", ACCENT)}>{action.time}</span>
        <span className={cn(SERIF, "text-[13px] font-bold leading-snug", INK, state === "undone" && "line-through opacity-50")}>
          {action.text}
        </span>
      </div>
      <p className={cn(SERIF, "mt-0.5 text-[11.5px] leading-snug", MUTED, state === "undone" && "line-through opacity-50")}>
        {action.detail}
      </p>
      <div className="mt-1.5 flex items-center gap-1.5">
        {state === "pending" ? (
          <>
            <InkButton onClick={onApprove}>
              <CheckIcon size={9} weight="bold" /> Approve
            </InkButton>
            <InkButton onClick={onUndo}>
              <ArrowCounterClockwiseIcon size={9} weight="bold" /> Undo
            </InkButton>
          </>
        ) : (
          <span className={cn("font-mono text-[8px] font-bold uppercase tracking-[0.2em]", state === "approved" ? INK : ACCENT)}>
            {state === "approved" ? "— Approved by the editor" : "— Retracted; correction to follow"}
          </span>
        )}
      </div>
    </li>
  );
}

// ─── Urgent letter to the editor ──────────────────────────────────────────────

export function FireLetter() {
  const [sent, setSent] = useState(false);
  return (
    <div className={cn("border-2 border-[color:var(--np-accent)] p-3")}>
      <div className="border-b-2 border-[color:var(--np-accent)] pb-1 text-center">
        <span className={cn("font-mono text-[9px] font-bold uppercase tracking-[0.26em]", ACCENT)}>
          {FIRE_TICKET.heading}
        </span>
      </div>
      <div className={cn("mt-2 font-mono text-[9px] tracking-[0.12em]", MUTED)}>
        TICKET {FIRE_TICKET.ticketId} · FROM {FIRE_TICKET.from.toUpperCase()}
      </div>
      <p className={cn(SERIF, "mt-1.5 text-[13px] font-bold leading-relaxed", INK)}>
        “{FIRE_TICKET.excerpt}”
      </p>
      <div className={cn("mt-3 border-t pt-2", RULE)}>
        <div className={cn("font-mono text-[8px] font-bold uppercase tracking-[0.2em]", MUTED)}>
          {FIRE_TICKET.suggestedReplyLabel}
        </div>
        <p className={cn(SERIF, "mt-1 text-[12px] leading-relaxed", INK)}>{FIRE_TICKET.suggestedReply}</p>
        <div className="mt-2">
          {sent ? (
            <span className={cn("font-mono text-[9px] font-bold uppercase tracking-[0.2em]", INK)}>
              — Reply dispatched, 07:31. Await tomorrow&apos;s letters page.
            </span>
          ) : (
            <InkButton onClick={() => setSent(true)} filled>
              <PaperPlaneTiltIcon size={9} weight="bold" /> Send reply
            </InkButton>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Churn obituaries ─────────────────────────────────────────────────────────

export function ObituaryNotice({ obit }: { obit: Obituary }) {
  const [sent, setSent] = useState(false);
  return (
    <div className={cn("border-t pt-3", RULE)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className={cn(SERIF, "text-[15px] font-bold tracking-tight", INK)}>{obit.name}</span>
        <span className={cn("font-mono text-[8px] uppercase tracking-[0.16em]", MUTED)}>{obit.tenure} on plan</span>
      </div>
      <p className={cn(SERIF, "mt-1 text-[12.5px] leading-relaxed", INK)}>{obit.notice}</p>
      <p className={cn("mt-1.5 font-mono text-[9px] leading-snug tracking-[0.06em]", MUTED)}>
        <span className={cn("font-bold", ACCENT)}>CAUSE, PER THE CORONER (AI): </span>
        {obit.cause.toUpperCase()}
      </p>
      <div className="mt-2">
        {sent ? (
          <span className={cn("font-mono text-[8px] font-bold uppercase tracking-[0.2em]", INK)}>
            — Win-back posted. The department of second chances thanks you.
          </span>
        ) : (
          <InkButton onClick={() => setSent(true)}>
            <PaperPlaneTiltIcon size={9} weight="bold" /> Send win-back
          </InkButton>
        )}
      </div>
    </div>
  );
}

export function ObituariesColumn() {
  return (
    <div className="flex flex-col gap-3">
      {OBITUARIES.map((obit) => (
        <ObituaryNotice key={obit.id} obit={obit} />
      ))}
    </div>
  );
}

// ─── Classifieds ──────────────────────────────────────────────────────────────

export function ClassifiedBox({ ad }: { ad: ClassifiedAd }) {
  const [sent, setSent] = useState(false);
  const reducedMotion = useReducedMotion();

  return (
    <div className={cn("relative border p-3", RULE_STRONG)}>
      <div className={cn("font-mono text-[8px] font-bold uppercase tracking-[0.26em]", MUTED)}>{ad.category}</div>
      <div className={cn("mt-1 font-mono text-[9px] tracking-[0.08em]", MUTED)}>TO: {ad.to.toUpperCase()}</div>
      <div className={cn(SERIF, "mt-1 text-[14px] font-bold leading-tight", INK)}>{ad.subject}</div>
      <p className={cn(SERIF, "mt-1.5 text-[12px] leading-relaxed", INK)}>{ad.body}</p>
      <div className="mt-2.5">
        <InkButton onClick={() => setSent(true)} filled className={sent ? "pointer-events-none opacity-40" : undefined}>
          <PaperPlaneTiltIcon size={9} weight="bold" /> {sent ? "Dispatched" : "[Send now]"}
        </InkButton>
      </div>

      {/* The SENT stamp, slammed diagonally over the ad. */}
      <AnimatePresence>
        {sent ? (
          <motion.div
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
            initial={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 2.4, rotate: -4 }}
            animate={reducedMotion ? { opacity: 1 } : { opacity: 1, scale: 1, rotate: -12 }}
            transition={reducedMotion ? { duration: 0.15 } : { type: "spring", stiffness: 500, damping: 26, mass: 0.9 }}
          >
            <span
              className={cn(
                "border-4 border-[color:var(--np-accent)] px-4 py-1 font-mono text-2xl font-black uppercase tracking-[0.3em]",
                ACCENT,
              )}
              style={{ transform: reducedMotion ? "rotate(-12deg)" : undefined }}
            >
              Sent
            </span>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export function ClassifiedsRow() {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {CLASSIFIEDS.map((ad) => (
        <ClassifiedBox key={ad.id} ad={ad} />
      ))}
    </div>
  );
}

// ─── Body copy re-export convenience ─────────────────────────────────────────

export { BodyText };
