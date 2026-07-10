"use client";

import { DesignBadge, DesignCard } from "@/components/design-components";
import { CheckCircleIcon, ShieldCheckIcon } from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";

const protectionSteps = [
  "Rollout paused",
  "Tenant isolated",
  "Pinned to v1.0.46 — safe, because cleanup is still deferred",
  "Database restored",
  "Traffic switched",
  "Customer restored",
] as const;

export function ProtectChecklist({ active }: { active: boolean }) {
  const shouldReduceMotion = useReducedMotion();
  const [visibleCount, setVisibleCount] = useState(0);

  useEffect(() => {
    if (!active) {
      setVisibleCount(0);
      return;
    }

    if (shouldReduceMotion) {
      setVisibleCount(protectionSteps.length);
      return;
    }

    const timers = protectionSteps.map((_, index) => window.setTimeout(
      () => setVisibleCount(index + 1),
      140 * (index + 1),
    ));
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [active, shouldReduceMotion]);

  if (!active) return null;

  return (
    <DesignCard
      title="Customer protection"
      subtitle="Only the affected customers moved back. Healthy customers stayed on the new version."
      icon={ShieldCheckIcon}
      gradient="green"
      actions={<DesignBadge label={`${visibleCount} of ${protectionSteps.length} complete`} color="green" size="sm" />}
    >
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {protectionSteps.map((step, index) => {
          const visible = index < visibleCount;
          return (
            <motion.div
              key={step}
              initial={false}
              animate={{ opacity: visible ? 1 : 0.35, y: visible ? 0 : 3 }}
              transition={{ duration: shouldReduceMotion ? 0 : 0.18 }}
              className="flex min-h-12 items-center gap-2 rounded-xl bg-foreground/[0.035] px-3 py-2 ring-1 ring-foreground/[0.05]"
            >
              <CheckCircleIcon
                className={visible ? "h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" : "h-4 w-4 shrink-0 text-muted-foreground"}
                weight={visible ? "fill" : "regular"}
              />
              <span className="text-xs font-medium text-foreground">{step}</span>
            </motion.div>
          );
        })}
      </div>
      <motion.div
        initial={false}
        animate={{ opacity: visibleCount === protectionSteps.length ? 1 : 0 }}
        className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-emerald-500/[0.07] px-3 py-2 ring-1 ring-emerald-500/15"
      >
        <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">Customer service restored</span>
        <span className="font-mono text-xs tabular-nums text-emerald-700 dark:text-emerald-300">
          Sessions lost: 0 · Re-auths forced: 0
        </span>
      </motion.div>
    </DesignCard>
  );
}
