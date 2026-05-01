export type DashboardDateInput = Date | string | number

const ABSOLUTE_DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
})

const RELATIVE_DATE_UNITS = [
  { max: 60, seconds: 1, singular: "sec", plural: "secs" },
  { max: 60, seconds: 60, singular: "min", plural: "mins" },
  { max: 24, seconds: 60 * 60, singular: "hr", plural: "hrs" },
  { max: 7, seconds: 60 * 60 * 24, singular: "day", plural: "days" },
  { max: 5, seconds: 60 * 60 * 24 * 7, singular: "week", plural: "weeks" },
  { max: 7, seconds: 60 * 60 * 24 * 30, singular: "month", plural: "months" },
]

export function parseDashboardDate(value: DashboardDateInput): Date {
  const date = value instanceof Date ? new Date(value) : new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid dashboard date: ${String(value)}`)
  }
  return date
}

export function formatAbsoluteDashboardDate(value: DashboardDateInput): string {
  return ABSOLUTE_DATE_FORMATTER.format(parseDashboardDate(value))
}

export function formatRecentDashboardDate(
  value: DashboardDateInput | null | undefined,
  options?: { now?: Date },
): string {
  if (value == null) return "-"

  const date = parseDashboardDate(value)
  const now = options?.now == null ? new Date() : parseDashboardDate(options.now)
  const sixMonthsAgo = new Date(now)
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)
  const sixMonthsFromNow = new Date(now)
  sixMonthsFromNow.setMonth(sixMonthsFromNow.getMonth() + 6)

  if (date < sixMonthsAgo || date > sixMonthsFromNow) {
    return formatAbsoluteDashboardDate(date)
  }

  const diffSeconds = Math.round((date.getTime() - now.getTime()) / 1000)
  const absSeconds = Math.abs(diffSeconds)
  if (absSeconds < 15) return "just now"

  for (const unit of RELATIVE_DATE_UNITS) {
    const amount = Math.round(absSeconds / unit.seconds)
    if (amount < unit.max) {
      const label = amount === 1 ? unit.singular : unit.plural
      return diffSeconds < 0 ? `${amount} ${label} ago` : `in ${amount} ${label}`
    }
  }

  const months = Math.min(6, Math.round(absSeconds / (60 * 60 * 24 * 30)))
  return diffSeconds < 0 ? `${months} months ago` : `in ${months} months`
}
