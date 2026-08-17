// Periodic/per-request bulldozer logs (heap stats, handler timing, activity
// windows, etc.) are only useful for production observability. In local dev
// they drown out the interesting output, and in CI (NODE_ENV=test) the e2e
// suites fire thousands of bulldozer requests, producing ~100k lines that bury
// the actual failure. Keep them only when NODE_ENV is neither of those.
export const shouldSuppressPeriodicBulldozerLogs = process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";
