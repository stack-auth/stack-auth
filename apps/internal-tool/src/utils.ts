/**
 * SpacetimeDB timestamps are { __timestamp_micros_since_unix_epoch__: bigint }.
 * Convert to a JS Date.
 */
export function toDate(ts: unknown): Date {
  if (ts instanceof Date) return ts;
  if (typeof ts === "object" && ts !== null && "__timestamp_micros_since_unix_epoch__" in ts) {
    const micros = (ts as Record<string, unknown>).__timestamp_micros_since_unix_epoch__;
    if (typeof micros !== "bigint") {
      throw new TypeError(`Expected __timestamp_micros_since_unix_epoch__ to be bigint, got ${typeof micros}`);
    }
    return new Date(Number(micros / 1000n));
  }
  if (typeof ts === "bigint") {
    return new Date(Number(ts / 1000n));
  }
  if (typeof ts === "number") {
    return new Date(ts);
  }
  throw new TypeError(`Cannot convert ${typeof ts} to Date`);
}

/**
 * Sum the per-step USD cost for a set of step runs. costUsd is the step's
 * token usage priced at the model's OpenRouter per-token rates (falling back
 * to Claude Code's self-reported `total_cost_usd` when pricing is
 * unavailable), stored as a fixed-precision string (undefined until a step
 * reports a result), so the total grows live as each step completes.
 */
export function sumStepCost(steps: { costUsd?: string }[]): number {
  let total = 0;
  for (const step of steps) {
    if (!step.costUsd) continue;
    const value = Number.parseFloat(step.costUsd);
    if (Number.isFinite(value)) total += value;
  }
  return total;
}

/** Format a USD amount with enough precision for sub-cent agent costs. */
export function formatUsd(cost: number): string {
  if (cost <= 0) return "$0";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  if (cost < 1) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(2)}`;
}

export type StepTokenFields = {
  inputTokens?: bigint,
  outputTokens?: bigint,
  cacheReadTokens?: bigint,
  cacheCreationTokens?: bigint,
};

export type TokenTotals = {
  input: number,
  output: number,
  cacheRead: number,
  cacheCreation: number,
  total: number,
};

/**
 * Sum token usage across step runs. Each step's usage is the cumulative figure
 * from Claude Code's final `result` message, so totals grow live per completed
 * step. `total` is the all-in sum (fresh input + output + cache read + write).
 */
export function sumStepTokens(steps: StepTokenFields[]): TokenTotals {
  const totals: TokenTotals = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 };
  for (const step of steps) {
    totals.input += Number(step.inputTokens ?? 0n);
    totals.output += Number(step.outputTokens ?? 0n);
    totals.cacheRead += Number(step.cacheReadTokens ?? 0n);
    totals.cacheCreation += Number(step.cacheCreationTokens ?? 0n);
  }
  totals.total = totals.input + totals.output + totals.cacheRead + totals.cacheCreation;
  return totals;
}

/** Compact token count: 1234 → "1.2k", 1500000 → "1.5M". */
export function formatTokens(count: number): string {
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${(count / 1000).toFixed(count < 10_000 ? 1 : 0)}k`;
  return `${(count / 1_000_000).toFixed(2)}M`;
}
