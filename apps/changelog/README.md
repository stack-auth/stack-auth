# Stack Auth Changelog

A lightweight, static changelog viewer that renders the single source-of-truth `CHANGELOG.md` that lives in the root of the Stack Auth monorepo.

## Development

```bash
# Start dev server (watches CHANGELOG.md automatically)
pnpm dev

# Build for production
pnpm build

# Type check
pnpm typecheck
```

The app runs on port `${NEXT_PUBLIC_STACK_PORT_PREFIX:-81}09` (default: 8109).

## How It Works

1. The Next.js app reads `/CHANGELOG.md` directly from the repo root on every build request (no generated files needed)
2. Entries are parsed into structured data and rendered in the UI
3. Static export works because all parsing happens during the server-component render

### Authoring Tips

- Add an `## Unreleased` section at the top of `/CHANGELOG.md` to stage work in progress. It renders with an “Unreleased” badge until you move the notes into a numbered section.
- Tag specific packages/apps inside bullet items using `[tag]` prefixes, e.g. `- [dashboard][billing] Fix totals`. Tags render as pills; if you omit them the bullet shows no pill (use `[all]` explicitly if you want that label).
- You can append a release date to the heading with parentheses: `## 2.8.57 (2025-02-14)`. The parser stores and displays the ISO date next to the version.

## Single Source of Truth

All changelog entries should be added to `/CHANGELOG.md` at the root of the repo. Once you commit that file, the changelog app automatically reflects the updates—no extra scripts or generated artifacts required.

## Deployment

This app is configured for static export (`output: 'export'` in next.config.mjs). Deploy to Vercel or any static hosting provider.

```bash
# Build produces static files in ./out/
pnpm build
```

## API Access

Need the changelog in another app or site? Hit `GET /api/changelog` from this project. The endpoint responds with the parsed entries from `/CHANGELOG.md`, plus metadata like `updatedAt` and `totalEntries`, so other surfaces can stay in sync without duplicating parsing logic.
