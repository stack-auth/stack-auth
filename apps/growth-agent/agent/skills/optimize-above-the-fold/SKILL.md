---
description: Execute the "Optimize above-the-fold" growth analysis topic — audit the landing page's first screen against what converting users actually respond to, and propose concrete copy/layout changes.
---

# Optimize above-the-fold

Goal: make the first screen of the project's landing page convert better by grounding its headline, subheadline, and primary CTA in who actually signs up and activates.

## Data to pull

1. `get-context-bundle` — product context, website URL, and any website-research findings (positioning, audience, competitor headlines) already saved in this run.
2. `get-metrics` — signup baseline, so recommendations reference the current conversion reality.
3. `sql-query` — where the data exists, answer:
   - Which referrer/UTM sources produce users who activate (fire product events after signup) vs. bounce?
   - What share of signups happens within one session of first visit (a proxy for how hard the first screen has to work)?
   - Send the queries above as ONE batched `sql-query` call (it takes up to 10); they are independent, so splitting them across calls only adds model round trips.
4. If website-research findings describe the current hero (headline, CTA, social proof), use them; do not re-crawl.

## What to produce

- 2-4 `save-finding` calls, kind `above-the-fold`: each one names a specific weakness of the current first screen (e.g. headline describes features while activating users come from a jobs-to-be-done search term) with the evidence behind it.
- One `save-artifact`, kind `copy_proposal`, titled "Above-the-fold proposal": a markdown document containing, for each proposed change — current state, proposed replacement (exact copy, not directions), and the evidence for it. Include at least: headline, subheadline, primary CTA label, and one social-proof/credibility element.
- Optionally one `create-action-item` (type `custom`) if a change is high-confidence and self-contained enough to hand straight to the team; reference the artifact id in the payload.

## Quality bar

- Proposed copy is written out verbatim and speaks the ICP's language as evidenced by the data (sources, search terms, activating segments) — never generic marketing filler.
- Every recommendation cites its evidence; if the project lacks traffic data, say so in a finding and ground proposals in the website/competitor research instead, labeling them as such.
- Do not propose A/B testing infrastructure or redesigns; stay within copy and first-screen structure.
