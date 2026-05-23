# PR Body Template

Markdown structure for a visual-heavy PR description. Adapt freely — these are patterns, not a rigid form.

## Top-of-body template

```markdown
## Summary

<1-2 paragraphs explaining what the PR does and why. Not the commit list.>

**Base:** `<base>` → **Head:** `<head>`
**Scope:** <N> files, ~+<M>k additions

## Screenshots

Captured from the local dev server (viewport: **<W>×<H>** standard, **<W2>×<H2>** widescreen). Assets hosted in [this gist](<gist-url>).

> 🔴 Red outlines on the "after" shots mark the new or changed UI introduced by this PR.

### <Flagship page 1> — <short descriptor>

|        | Before | After |
| ---    | ---    | ---   |
| Light  | ![<page>-before-light](<url>) | ![<page>-after-light](<url>) |
| Dark   | ![<page>-before-dark](<url>)  | ![<page>-after-dark](<url>)  |

Widescreen:

|        | Before | After |
| ---    | ---    | ---   |
| Light  | ![<page>-before-light-wide](<url>) | ![<page>-after-light-wide](<url>) |
| Dark   | ![<page>-before-dark-wide](<url>)  | ![<page>-after-dark-wide](<url>)  |

### <Flagship page 2>

<...same before/after pattern...>

### Other migrated surfaces (after only)

| Page | Light | Dark |
| --- | --- | --- |
| <name> | ![<page>-after-light](<url>) | ![<page>-after-dark](<url>) |
| <name> | ![<page>-after-light](<url>) | ![<page>-after-dark](<url>) |

### <Optional: scroll behaviour / sticky header / interactions>

| Page | Light | Dark |
| --- | --- | --- |
| <name> | ![<page>-scroll-light](<gif-url>) | ![<page>-scroll-dark](<gif-url>) |
```

## What goes after the visuals

Everything normal for a PR body: _What's new_, _Notes for reviewers_, _Test plan_. Don't skip these — the visuals sell the PR but reviewers still need a map of the code.

## Picking flagship vs. long-tail pages

Flagship treatment (its own section, widescreen variant, maybe a scroll GIF):
- Pages with the richest content in this PR
- Pages the reviewer is most likely to open first
- Usually 3-5 max — more and the body gets noisy

Long-tail treatment (one row in the "Other surfaces" table):
- Same-pattern pages where the screenshot is mostly the existing dashboard chrome
- Empty-state or near-empty pages where seed data didn't populate them

## Alt text

Use the base filename as alt text (e.g. `users-after-light`) — it's greppable, consistent, and survives when images fail to load. The `before`/`after` token in the alt text matters: if the gist is ever wiped, reviewers can still tell from broken-image alt which cell was which.

## Before/after pairing rules

- For every "after" shot in a flagship section, pair it with the matching "before" shot at the same theme + viewport.
- If there is no "before" (greenfield route), use a one-row "After only" table and note `*New route — no base equivalent.*` underneath.
- If "before" and "after" are pixel-identical for a long-tail page (refactor that didn't touch this surface), drop that page from the body entirely. Don't pad with no-op pairs.

## Don't do these

- **Don't embed 20+ inline images.** If you have that many UI surfaces, you probably have a few flagships + a long tail. Put the long tail in a compact table, not a wall of images.
- **Don't mix hosting sources.** If some images are on `user-attachments` and others on gist, reviewers can't tell why and the mixing looks sloppy. Pick one hosting path and stick to it.
- **Don't forget the non-visual sections.** A PR body that's 90% screenshots and 10% prose reads as marketing, not engineering communication.
- **Don't use HTML `<video>` or `<details>` with videos.** GitHub sanitizes both unless the video is on `user-attachments`. Use GIFs (which render as images).
