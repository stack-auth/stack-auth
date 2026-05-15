# PR body template

Reconstructed from SKILL.md hints. Treat this as a starting point and adapt to the PR's actual content — don't force-fit sections that don't apply.

## Full structure

```markdown
## Summary

<One-paragraph summary of what the PR does and why. Reviewer-oriented, not
changelog-oriented — answer "what am I about to review and why does it exist".>

**Base:** `<base-branch>` → **Head:** `<head-branch>`
**Scope:** <N> files changed · +<added> / -<removed> lines

---

## Screenshots

### <Flagship page 1 name>

<One-line description of the page and what changed.>

| Light | Dark |
| --- | --- |
| ![light](<raw-url>) | ![dark](<raw-url>) |

<Widescreen if captured:>

| Wide (light) | Wide (dark) |
| --- | --- |
| ![wide-light](<raw-url>) | ![wide-dark](<raw-url>) |

### <Flagship page 2 name>

...

---

### Other migrated surfaces

| Page | Light | Dark |
| --- | --- | --- |
| Route A | ![](<raw-url>) | ![](<raw-url>) |
| Route B | ![](<raw-url>) | ![](<raw-url>) |
| ...    | ...             | ...             |

---

## Scroll behaviour

| Light | Dark |
| --- | --- |
| ![scroll-light](<raw-url>) | ![scroll-dark](<raw-url>) |

---

## What's new

- bullet 1
- bullet 2

## Notes for reviewers

- Anything tricky, non-obvious, or worth flagging.
- Known follow-ups or things deliberately out of scope.

## Test plan

- [ ] Check X
- [ ] Check Y
- [ ] Visual sanity — the screenshots above are the canonical reference.
```

## Patterns that pull weight

- **Two-column tables for light/dark**: reviewers can scan both themes at once without scrolling vertically. A single-column list of 10 alternating light/dark shots is much harder to parse.
- **Flagship vs. long tail**: promote 3–5 pages with their own subsection + heading. Everything else goes in a compact table. This gives reviewers a clear "start here" signal.
- **Raw URLs, not markdown image links with titles**: keep `![alt](url)` minimal. Long alt text makes the source unreadable for anyone editing later.
- **Scope line up top**: the `files changed · +x/-y` line answers "how big is this" before the reviewer scrolls.

## Anti-patterns

- Don't embed WebM. Gist-hosted WebM renders as a download link, not a player. Convert to GIF first.
- Don't link to the gist itself — link directly to each raw URL so the asset renders inline.
- Don't include a mega-wall of every page × every theme. If the PR touches 15 pages, put 5 in the hero and 10 in the compact table.
- Don't skip the text sections (What's new / Test plan) just because you have pretty pictures. Reviewers still want the prose.
