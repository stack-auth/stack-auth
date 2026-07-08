"use client";

import { DesignPillToggle } from "@/components/design-components";
import { BRIEFING_ROLES, type BriefingDepth, type BriefingRole } from "../briefing-config";

// Demo prop for permission scoping: switching roles live-filters which
// sections render unlocked. Not a real ACL — that's the point of the concept.

export function RoleSwitcher({ role, onChange }: { role: BriefingRole, onChange: (role: BriefingRole) => void }) {
  return (
    <DesignPillToggle
      size="sm"
      gradient="purple"
      options={BRIEFING_ROLES.map((r) => ({ id: r.id, label: r.label }))}
      selected={role}
      onSelect={(id) => onChange(id as BriefingRole)}
    />
  );
}

export function DepthToggle({ depth, onChange }: { depth: BriefingDepth, onChange: (depth: BriefingDepth) => void }) {
  return (
    <DesignPillToggle
      size="sm"
      gradient="blue"
      options={[
        { id: "executive", label: "Executive" },
        { id: "operator", label: "Operator" },
      ]}
      selected={depth}
      onSelect={(id) => onChange(id as BriefingDepth)}
    />
  );
}
