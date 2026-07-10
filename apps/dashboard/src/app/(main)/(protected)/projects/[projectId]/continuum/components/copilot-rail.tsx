"use client";

import { DesignBadge } from "@/components/design-components";
import { RobotIcon, SparkleIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { DATABASES_COPILOT_HINTS } from "../fixtures/copilot-script";

const RESPONSES = [
  "I’ll use the 5 GB sample, keep whole organizations together, and replace sensitive values with realistic fakes.",
  "The cleanup only removes legacy_role after every active version has moved forward. It is waiting safely right now.",
  "The current write path would affect 37 organizations. I recommend a compatibility release and backfill first.",
] as const;

export function CopilotRail() {
  const [selectedHint, setSelectedHint] = useState(0);

  return (
    <aside className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border/60 px-4 py-4">
        <div className="flex items-center gap-2">
          <RobotIcon className="h-4 w-4" />
          <p className="text-xs font-semibold uppercase tracking-wider">Database copilot</p>
          <DesignBadge label="Ready" color="green" size="sm" />
        </div>
        <p className="mt-1 text-xs text-muted-foreground">Understands branches, data shape, and release safety.</p>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <div className="rounded-xl bg-primary/[0.06] p-3 text-xs leading-5 ring-1 ring-primary/10">
          <div className="mb-1 flex items-center gap-1.5 font-medium"><SparkleIcon className="h-3.5 w-3.5" />Copilot</div>
          {RESPONSES[selectedHint]}
        </div>
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Try asking</p>
          <div className="space-y-2">
            {DATABASES_COPILOT_HINTS.map((hint, index) => (
              <button
                key={hint}
                type="button"
                onClick={() => setSelectedHint(index)}
                className={`w-full rounded-xl px-3 py-2.5 text-left text-xs leading-5 ring-1 transition-colors duration-150 hover:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                  selectedHint === index
                    ? "bg-primary/[0.07] ring-primary/20"
                    : "bg-foreground/[0.02] ring-border/60 hover:bg-foreground/[0.05]"
                }`}
              >
                {hint}
              </button>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
}
