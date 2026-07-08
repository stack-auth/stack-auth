"use client";

import { DesignAnalyticsCard } from "@/components/design-components";
import { Typography } from "@/components/ui";
import { SECTION_META, type BriefingSectionId } from "../briefing-config";

// Temporary placeholder rendered while a section's real widget is being built.
// Each real widget file replaces its stub import in page-client.tsx.

export function SectionStub({ sectionId }: { sectionId: BriefingSectionId }) {
  const meta = SECTION_META[sectionId];
  return (
    <DesignAnalyticsCard gradient={meta.accent}>
      <div className="flex flex-col gap-2 p-5">
        <Typography type="p" variant="secondary" className="text-sm">
          {meta.blurb}
        </Typography>
        <div className="mt-2 space-y-2">
          <div className="h-3 w-2/3 animate-pulse rounded-full bg-foreground/[0.07]" />
          <div className="h-3 w-1/2 animate-pulse rounded-full bg-foreground/[0.05]" />
          <div className="h-3 w-3/5 animate-pulse rounded-full bg-foreground/[0.04]" />
        </div>
        <Typography type="p" variant="secondary" className="mt-2 text-xs uppercase tracking-wider text-foreground/40">
          Coming online
        </Typography>
      </div>
    </DesignAnalyticsCard>
  );
}
