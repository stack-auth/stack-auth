"use client";

import { DesignBadge } from "@/components/design-components";
import type { SourceListItem, SyncRunDto } from "./api";

/**
 * Status vocabulary, matching what users already know from Airbyte and
 * Fivetran: Healthy / Syncing / Failed / Paused.
 */
export function SourceStatusBadge(props: { status: SourceListItem["status"] }) {
  switch (props.status) {
    case "HEALTHY": {
      return <DesignBadge label="Healthy" color="green" size="sm" />;
    }
    case "SYNCING": {
      return <DesignBadge label="Syncing" color="blue" size="sm" />;
    }
    case "FAILED": {
      return <DesignBadge label="Failed" color="red" size="sm" />;
    }
    case "PAUSED": {
      return <DesignBadge label="Paused" color="orange" size="sm" />;
    }
  }
}

export function RunStatusBadge(props: { status: SyncRunDto["status"] }) {
  switch (props.status) {
    case "SUCCEEDED": {
      return <DesignBadge label="Succeeded" color="green" size="sm" />;
    }
    case "RUNNING": {
      return <DesignBadge label="Running" color="blue" size="sm" />;
    }
    case "FAILED": {
      return <DesignBadge label="Failed" color="red" size="sm" />;
    }
    case "CANCELED": {
      return <DesignBadge label="Canceled" color="cyan" size="sm" />;
    }
  }
}

export function formatDuration(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export function formatTimestamp(value: string | null): string {
  if (value == null) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

export function formatSchedule(kind: string, value: string | null): string {
  switch (kind) {
    case "interval": {
      const minutes = Number(value);
      if (!Number.isFinite(minutes)) return "Not scheduled";
      if (minutes % 1440 === 0) return `Every ${minutes / 1440}d`;
      if (minutes % 60 === 0) return `Every ${minutes / 60}h`;
      return `Every ${minutes}m`;
    }
    case "cron": {
      return `Cron: ${value ?? "—"}`;
    }
    default: {
      return "Manual";
    }
  }
}

export function formatRowCount(count: number): string {
  return new Intl.NumberFormat().format(count);
}

export const CATEGORY_LABELS: Record<string, string> = {
  payments: "Payments",
  crm: "CRM",
  marketing: "Marketing",
  support: "Support",
  product: "Product",
  engineering: "Engineering",
  hr: "HR & Recruiting",
  finance: "Finance",
  analytics: "Analytics",
  database: "Databases",
  files: "Files & Storage",
  other: "Other",
};

/**
 * A connector's monogram, standing in for a vendor logo.
 *
 * Bundling ~100 third-party marks would mean shipping other companies'
 * trademarks; a deterministic monogram keeps the grid scannable without that.
 */
export function ConnectorMark(props: { name: string, size?: "sm" | "md" }) {
  const initials = props.name
    .replace(/[^A-Za-z0-9 ]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(word => word.slice(0, 1).toUpperCase())
    .join("") || "?";
  // Hash the name to a stable hue so the same connector always looks the same.
  let hash = 0;
  for (let i = 0; i < props.name.length; i++) {
    hash = (hash * 31 + props.name.charCodeAt(i)) % 360;
  }
  const dimension = props.size === "md" ? "h-10 w-10 text-sm" : "h-8 w-8 text-xs";
  return (
    <div
      className={`flex ${dimension} flex-shrink-0 items-center justify-center rounded-lg font-semibold text-white`}
      style={{ backgroundColor: `hsl(${hash}, 45%, 45%)` }}
      aria-hidden
    >
      {initials}
    </div>
  );
}
