import type { FormatKind, FormatKindType, AnalyticsChartDelta } from "./types";

export const FORMAT_KIND_TYPES: FormatKindType[] = [
  "numeric",
  "short",
  "currency",
  "duration",
  "datetime",
  "percent",
];

export const DEFAULT_FORMAT_KIND: { [K in FormatKindType]: Extract<FormatKind, { type: K }> } = {
  numeric: { type: "numeric", locale: "en-US", decimals: 0 },
  short: { type: "short", precision: 1, locale: "en-US" },
  currency: { type: "currency", currency: "USD", divisor: 100, locale: "en-US" },
  duration: { type: "duration", unit: "s", showZero: false },
  datetime: { type: "datetime", style: "short", locale: "en-US" },
  percent: { type: "percent", source: "fraction", decimals: 1 },
};

function formatRelative(value: number, locale: string): string {
  const diff = value - Date.now();
  const absSec = Math.abs(diff) / 1000;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (absSec >= 86_400) return rtf.format(Math.round(diff / 86_400_000), "day");
  if (absSec >= 3600) return rtf.format(Math.round(diff / 3_600_000), "hour");
  if (absSec >= 60) return rtf.format(Math.round(diff / 60_000), "minute");
  return "just now";
}

/** `short` uses compact notation (e.g. `1.2K`), not a custom `k` suffix. */
export function formatValue(value: number, kind: FormatKind): string {
  switch (kind.type) {
    case "numeric": {
      const decimals = kind.decimals ?? 0;
      return value.toLocaleString(kind.locale ?? "en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });
    }
    case "short": {
      const precision = kind.precision ?? 1;
      return new Intl.NumberFormat(kind.locale ?? "en-US", {
        notation: "compact",
        compactDisplay: "short",
        minimumFractionDigits: precision,
        maximumFractionDigits: precision,
      }).format(value);
    }
    case "currency": {
      const divisor = kind.divisor ?? 1;
      return new Intl.NumberFormat(kind.locale ?? "en-US", {
        style: "currency",
        currency: kind.currency ?? "USD",
      }).format(value / divisor);
    }
    case "duration": {
      const unit = kind.unit ?? "s";
      const seconds = unit === "ms" ? value / 1000
        : unit === "m" ? value * 60
          : unit === "h" ? value * 3600
            : value;
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      const s = Math.floor(seconds % 60);
      if (h > 0) return `${h}h ${m}m ${s}s`;
      if (m > 0) return `${m}m ${s}s`;
      if (unit === "ms" && seconds < 1) return `${Math.round(value)}ms`;
      if (s > 0 || kind.showZero) return `${s}s`;
      return "0s";
    }
    case "datetime": {
      const d = new Date(value);
      const style = kind.style ?? "short";
      const locale = kind.locale ?? "en-US";
      if (style === "iso") return d.toISOString();
      if (style === "relative") return formatRelative(value, locale);
      if (style === "long") return d.toLocaleString(locale, {
        dateStyle: "medium",
        timeStyle: "short",
      });
      return d.toLocaleDateString(locale, { month: "short", day: "numeric" });
    }
    case "percent": {
      const source = kind.source ?? "fraction";
      const decimals = kind.decimals ?? 1;
      const pct = source === "basis" ? value / 100
        : source === "whole" ? value
          : value * 100;
      return `${pct.toFixed(decimals)}%`;
    }
  }
}

export function formatDelta(current: number, previous: number): AnalyticsChartDelta {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return { pct: null, sign: "na" };
  if (previous === 0) return current === 0 ? { pct: 0, sign: "flat" } : { pct: null, sign: "na" };
  const pct = Number((((current - previous) / previous) * 100).toFixed(1));
  const sign = pct > 0 ? "up" : pct < 0 ? "down" : "flat";
  return { pct, sign };
}
