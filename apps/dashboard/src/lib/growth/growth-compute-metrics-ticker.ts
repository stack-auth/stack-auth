/**
 * Pure sequencing logic for the "Computing metrics" block's animated sub-list (see
 * lifecycle-panels.tsx). While the compute-metrics phase runs, the block cycles through the
 * catalog's metric labels ("Computing daily active users", ...) so the breadth of the rollup
 * registers.
 *
 * Honesty note: the real phase computes all metrics in one backend batch — there is no per-metric
 * progress on the wire. This ticker is presentational pacing layered over the phase's real state,
 * which alone decides done/failed; the sub-list only ever claims a metric is "being computed",
 * never that any individual one finished for real.
 */

/** ~700ms per label: fast enough to feel busy, slow enough to be readable. */
export const GROWTH_COMPUTE_METRICS_TICK_MILLIS = 700;

export type GrowthComputeMetricsTickerFrame = {
  /** The few labels "finished" earlier in this pass, oldest first — rendered ticked above `current`. */
  done: string[],
  /** The label currently rendered as in progress. */
  current: string,
};

/**
 * The frame to render after `tick` timer advances (tick 0 = first render). Loops over the labels if
 * the phase outlives one pass — the real work is a single batch, so looping is the least-dishonest
 * way to keep the block alive; each pass starts with an empty done-window rather than wrapping the
 * previous pass's tail around, so a loop restart is visible instead of pretending endless progress.
 * Returns null for an empty label list (the caller renders no sub-list at all).
 */
export function getGrowthComputeMetricsTickerFrame(labels: string[], tick: number, maxVisibleDone: number): GrowthComputeMetricsTickerFrame | null {
  if (labels.length === 0 || tick < 0 || maxVisibleDone < 0) {
    return null;
  }
  const indexInPass = tick % labels.length;
  const doneCount = Math.min(maxVisibleDone, indexInPass);
  return {
    done: labels.slice(indexInPass - doneCount, indexInPass),
    current: labels[indexInPass],
  };
}
