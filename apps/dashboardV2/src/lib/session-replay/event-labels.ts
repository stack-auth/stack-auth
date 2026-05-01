export const RRWEB_EVENT_TYPE_LABELS: Record<number, string> = {
  0: "DOM content loaded",
  1: "Load",
  2: "Full snapshot",
  3: "Incremental snapshot",
  4: "Meta",
  5: "Custom",
  6: "Plugin",
}

export const RRWEB_INCREMENTAL_SOURCE_LABELS: Record<number, string> = {
  0: "Mutation",
  1: "Mouse move",
  2: "Mouse interaction",
  3: "Scroll",
  4: "Viewport resize",
  5: "Input",
  6: "Touch move",
  7: "Media interaction",
  8: "Style sheet rule",
  9: "Canvas mutation",
  10: "Font",
  11: "Log",
  12: "Drag",
  13: "Style declaration",
  14: "Selection",
  15: "Adopted style sheet",
  16: "Custom element",
}

export type EventCategory =
  | "Mouse"
  | "Click"
  | "Input"
  | "Scroll"
  | "Mutation"
  | "Snapshot"
  | "Meta"
  | "Custom"
  | "Plugin"
  | "Other"

export const EVENT_CATEGORIES: Array<EventCategory> = [
  "Mouse",
  "Click",
  "Input",
  "Scroll",
  "Mutation",
  "Snapshot",
  "Meta",
  "Custom",
]

export type RrwebEventLite = {
  type: number,
  timestamp: number,
  data?: unknown,
}

export function readEventType(event: unknown): number | null {
  if (event == null || typeof event !== "object") return null
  const t = (event as { type?: unknown }).type
  return typeof t === "number" ? t : null
}

export function readEventTimestamp(event: unknown): number | null {
  if (event == null || typeof event !== "object") return null
  const ts = (event as { timestamp?: unknown }).timestamp
  return typeof ts === "number" ? ts : null
}

export function readEventData(event: unknown): Record<string, unknown> | null {
  if (event == null || typeof event !== "object") return null
  const d = (event as { data?: unknown }).data
  if (d == null || typeof d !== "object") return null
  return d as Record<string, unknown>
}

export function describeEvent(event: unknown): string {
  const type = readEventType(event)
  if (type == null) return "Event"
  const baseLabel = RRWEB_EVENT_TYPE_LABELS[type] ?? `Type ${type}`
  if (type === 3) {
    const data = readEventData(event)
    const source = data?.source
    if (typeof source === "number") {
      return RRWEB_INCREMENTAL_SOURCE_LABELS[source] ?? `src ${source}`
    }
  }
  if (type === 6) {
    const data = readEventData(event)
    const name = typeof data?.plugin === "string" ? data.plugin : null
    if (name === "rrweb/console@1") return "Console"
    if (typeof name === "string") return `Plugin: ${name}`
  }
  return baseLabel
}

export function categorizeEvent(event: unknown): EventCategory {
  const type = readEventType(event)
  if (type === 2) return "Snapshot"
  if (type === 4) return "Meta"
  if (type === 5) return "Custom"
  if (type === 6) return "Plugin"
  if (type !== 3) return "Other"
  const data = readEventData(event)
  const source = typeof data?.source === "number" ? data.source : -1
  switch (source) {
    case 0: return "Mutation"
    case 1: return "Mouse"
    case 2: {
      const interactionType = (data as { type?: unknown }).type
      if (typeof interactionType === "number" && interactionType === 2) return "Click"
      return "Mouse"
    }
    case 3: return "Scroll"
    case 5: return "Input"
    case 6: return "Mouse"
    default: return "Other"
  }
}

export function isClickEvent(event: unknown): boolean {
  if (readEventType(event) !== 3) return false
  const data = readEventData(event)
  if (typeof data?.source !== "number" || data.source !== 2) return false
  const interactionType = (data as { type?: unknown }).type
  return typeof interactionType === "number" && interactionType === 2
}

export function isPageNavigation(event: unknown): boolean {
  return readEventType(event) === 4
}

export function isConsolePluginEvent(event: unknown): boolean {
  if (readEventType(event) !== 6) return false
  const data = readEventData(event)
  return typeof data?.plugin === "string" && data.plugin === "rrweb/console@1"
}

export function getConsoleSeverity(event: unknown): "info" | "warn" | "error" {
  const data = readEventData(event)
  const payload = data?.payload as { level?: unknown } | undefined
  const level = typeof payload?.level === "string" ? payload.level : "log"
  if (level === "error" || level === "assert") return "error"
  if (level === "warn") return "warn"
  return "info"
}

export function getMetaUrl(event: unknown): string | null {
  if (readEventType(event) !== 4) return null
  const data = readEventData(event)
  if (typeof data?.href === "string") return data.href
  return null
}
