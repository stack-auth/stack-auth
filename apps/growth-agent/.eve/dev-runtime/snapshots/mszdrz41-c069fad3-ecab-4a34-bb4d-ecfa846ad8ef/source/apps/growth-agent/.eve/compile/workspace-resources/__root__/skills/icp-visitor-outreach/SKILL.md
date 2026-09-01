---
description: Execute the "ICP visitor outreach" growth analysis topic — identify signed-up users who match the ideal customer profile but stalled, and draft the outreach to re-engage them.
---

# ICP visitor outreach

Goal: find the users who look most like the project's ideal customer profile but never activated (or went quiet), and produce ready-to-send outreach that re-engages them.

## Data to pull

1. `get-context-bundle` — the ICP definition: onboarding answers, interview answers if present, and audience findings from website research. If no explicit ICP exists, derive a working one from the audience findings and say so.
2. `sql-query` — where the data exists:
   - Segment signed-up users by activation: never-activated vs. activated-then-dormant vs. active.
   - For the stalled segments, pull what is knowable about fit: signup source, email domain type (business vs. free-mail), events fired before stalling, and where in the product they stopped.
   - Size each segment so the outreach recommendation is proportionate.
   - Send the queries above as ONE batched `sql-query` call (it takes up to 10); they are independent, so splitting them across calls only adds model round trips.
3. `get-metrics` — baseline activity, to quantify what recovering these users would be worth.

## What to produce

- 2-4 `save-finding` calls, kind `outreach-opportunity`: each describes one stalled segment — its size, why it plausibly matches the ICP, where its users stopped, and the hypothesized blocker.
- One `save-artifact`, kind `outreach_template`, titled "ICP re-engagement outreach": markdown containing, per segment, a complete email (subject + body) written for that segment's stall point, plus guidance on send timing. Reference only user attributes the team can actually query.
- One `create-action-item` (type `custom`): the outreach campaign itself — which segment first, using which template (reference the artifact id in the payload), with `watched_metrics` set to `returning_users` over 14 days.

## Quality bar

- Segments are defined by queryable criteria (events, sources, domains), never vibes; include the defining query logic in the finding body.
- Outreach copy is specific to the stall point ("you connected X but never Y") — a generic "come back" email fails this analysis topic.
- Respect the data boundary: you may reference user attributes in segment definitions, but never paste individual users' emails or PII into findings or artifacts.
