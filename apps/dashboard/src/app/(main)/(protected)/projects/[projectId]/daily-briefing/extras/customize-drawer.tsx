"use client";

// Placeholder — replaced by the customize slide-over (section checklist +
// drag-to-reorder). Props are final so page-client doesn't change.

import { type BriefingSectionId } from "../briefing-config";

export function CustomizeDrawer(_props: {
  open: boolean,
  onOpenChange: (open: boolean) => void,
  sectionOrder: BriefingSectionId[],
  onReorder: (order: BriefingSectionId[]) => void,
  enabledSections: Set<BriefingSectionId>,
  onToggleSection: (id: BriefingSectionId) => void,
}) {
  return null;
}
