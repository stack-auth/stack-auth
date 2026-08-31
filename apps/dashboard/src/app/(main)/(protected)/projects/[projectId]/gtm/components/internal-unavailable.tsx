"use client";

import { DesignAlert } from "@/components/design-components";

export function GrowthInternalResourceUnavailable(props: { resource: string }) {
  return (
    <DesignAlert variant="info" title={`${props.resource} is staff-only`}>
      This Growth resource is available to your Hexclave team, but not in the customer workspace.
    </DesignAlert>
  );
}
