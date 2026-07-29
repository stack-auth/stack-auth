# Legacy docs redirects

This package keeps `docs.stack-auth.com` alive as a permanent redirect to [docs.hexclave.com](https://docs.hexclave.com).

All old Stack Auth URL paths are mapped here in `vercel.json`, not in Mintlify. Run `pnpm generate-docs-legacy-redirects` after changing path mappings in `scripts/generate-docs-legacy-redirects.ts`.

## Vercel setup

1. Create (or repoint) a Vercel project for the old docs domain.
2. Set the project **Root Directory** to `docs`.
3. Framework Preset should be **Other** — `vercel.json` sets `"framework": null` and skips install/build.
4. Attach the `docs.stack-auth.com` domain to this project.
5. Deploy — no build step is required; `vercel.json` handles all redirects.

Known old paths redirect directly to the matching page on `docs.hexclave.com`. Anything unmatched falls back to the docs home page.
