"use client";

import { DesignAlert } from "@/components/design-components";
import type { GtmLoadable } from "@/lib/gtm/gtm-data";
import type { ReactNode } from "react";

export function GtmSectionSkeleton(props: { className?: string }) {
  return <div role="status" aria-label="Loading" className={`animate-pulse rounded-2xl bg-foreground/[0.05] ${props.className ?? "h-48"}`} />;
}

export function GtmLoadableSection(props: { data: GtmLoadable, children: (value: Extract<GtmLoadable, { status: "loaded" }>["value"]) => ReactNode }) {
  if (props.data.status === "loading") return <GtmSectionSkeleton className="h-[34rem]" />;
  if (props.data.status === "error") return <DesignAlert variant="error" title="Could not load GTM data" description={props.data.message} />;
  return <>{props.children(props.data.value)}</>;
}
