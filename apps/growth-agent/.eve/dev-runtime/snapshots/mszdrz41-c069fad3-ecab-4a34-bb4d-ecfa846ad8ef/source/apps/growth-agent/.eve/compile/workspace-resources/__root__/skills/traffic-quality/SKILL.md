---
description: Execute the "Traffic quality" growth analysis topic — segment acquisition sources by downstream activation and retention, and recommend where to double down or cut.
---

# Traffic quality

Goal: rank the project's acquisition sources by the quality of users they deliver — not raw volume — and turn that into concrete double-down / fix / cut recommendations.

## Data to pull

1. `get-metrics` — overall signup and returning-user baselines to size each segment against.
2. `sql-query` — the core of this analysis topic; where the data exists:
   - Signups by source (referrer/UTM), by week, over the available window.
   - Per source: activation rate (signed-up users who later fire product events) and simple retention (users active again 7+ days after signup).
   - Volume vs. quality quadrants: high-volume/low-activation sources and low-volume/high-activation sources are the interesting corners.
   - Send the queries above as ONE batched `sql-query` call (it takes up to 10); they are independent, so splitting them across calls only adds model round trips.
3. `get-context-bundle` — product context, to sanity-check whether a "low quality" source is actually a mismatched audience.

## What to produce

- 3-6 `save-finding` calls:
  - kind `metric-baseline`: the per-source volume/activation/retention table's headline numbers (with the measurement window).
  - kind `traffic-quality`: one finding per notable pattern — e.g. a source with strong volume but half the average activation, or a small source that activates 2x above average. State the numbers, the comparison, and the implied action.
- 1-3 `create-action-item` calls (type `custom`, or `run_ads` when the recommendation is to shift paid spend): each names the source, the recommended change, and the expected effect; set `watched_metrics` to the metrics the change should move (e.g. `new_signups`, `returning_users` over 14 days).

## Paid acquisition

If the data points toward paid spend being worthwhile (a channel that already converts well and could scale, or a gap only paid can fill quickly), propose it as a `run_ads` action item. You have no ad-account access, so the proposal is entirely prose: name the channel, who to target, the landing page worth sending traffic to, and a first-test daily budget stated with its currency (e.g. "$30/day (USD)"). Frame it as a test, and say what result would justify continuing. Never state an ad performance number — you cannot see their campaigns.

## Quality bar

- Never rank sources on volume alone; every judgment pairs volume with a downstream quality measure.
- Call out small sample sizes explicitly — a 5-user source gets a caveat, not a verdict.
- If sources are untracked (no referrer/UTM data), the deliverable becomes one finding stating that plus a `custom` action item describing exactly what tracking to add.
