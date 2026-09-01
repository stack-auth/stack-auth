---
description: Execute the "SEO & AEO strategy" growth analysis topic — derive a search and answer-engine content strategy from the project's positioning, competitors, and organic traffic data.
---

# SEO & AEO strategy

Goal: a prioritized content strategy that wins both classic search (SEO) and answer engines / LLM assistants (AEO), grounded in what the product is and where its organic traffic already comes from.

## Data to pull

1. `get-context-bundle` — product context, website URL, and website-research findings (competitors, positioning, existing blog-idea findings).
2. `sql-query` — where the data exists:
   - Organic search share: signups/visits by referrer, isolating search engines.
   - Which organic-arriving users activate, to identify the intents worth ranking for.
   - Send the queries above as ONE batched `sql-query` call (it takes up to 10); they are independent, so splitting them across calls only adds model round trips.
3. Competitor findings from the bundle: what topics and comparison pages competitors own.

## What to produce

- 3-6 `save-finding` calls, kind `seo`: current organic baseline, the highest-value keyword/intent clusters (with the reasoning), and gaps vs. competitors (e.g. missing comparison or integration pages).
- One `save-artifact`, kind `content_strategy`, titled "SEO & AEO content plan": a markdown plan with:
  - A prioritized list of 5-10 content pieces; for each: working title, target intent/keyword cluster, why this project can win it, and the AEO angle (the direct question it answers, so assistants can cite it).
  - Site-level AEO recommendations: FAQ/structured-data opportunities, a clear "what is <product>" canonical answer, comparison pages.
- One `create-action-item` (type `publish_blog`) for the single highest-priority piece. Do NOT write the draft here — writing a full post is the single slowest thing this analysis topic can do, and it is wasted whenever the customer picks a different piece or none at all. Instead put the IDEA in the payload:
  { "blog_idea": { "title": "...", "target_intent": "...", "aeo_angle": "...", "outline_summary": "1-2 sentences on what the post should cover" } }
  The customer generates the actual draft on demand from the action item ("Generate draft" writes the `blog_draft` artifact and binds it to this item). Do not set `artifact_id` — the generation step sets it.

## Quality bar

- Priorities follow from evidence (traffic data, competitor gaps, positioning) — state the chain, don't assert.
- The blog idea is specific to this product, with a title that matches a real search intent; `outline_summary` is 1-2 sentences of substance (what the post must cover to win that intent), never a restatement of the title.
- AEO advice must be concrete per-page recommendations, not generic "add schema markup" boilerplate.
