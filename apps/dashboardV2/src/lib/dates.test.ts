import { describe, expect, it } from "vitest"

import { formatRecentDashboardDate } from "@/lib/dates"

describe("formatRecentDashboardDate", () => {
  const now = new Date("2026-05-01T12:00:00.000Z")

  it("formats recent dates relative to now", () => {
    expect(formatRecentDashboardDate(new Date("2026-05-01T11:59:50.000Z"), { now })).toBe("just now")
    expect(formatRecentDashboardDate(new Date("2026-05-01T11:57:00.000Z"), { now })).toBe("3 mins ago")
  })

  it("keeps dates within six months relative", () => {
    expect(formatRecentDashboardDate(new Date("2025-11-01T12:00:00.000Z"), { now })).toBe("6 months ago")
  })

  it("formats dates older than six months as absolute dates", () => {
    expect(formatRecentDashboardDate(new Date("2025-10-31T12:00:00.000Z"), { now })).toBe("Oct 31, 2025")
  })

  it("formats missing dates as a table placeholder", () => {
    expect(formatRecentDashboardDate(null, { now })).toBe("-")
  })
})
