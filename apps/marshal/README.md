# Marshal

The Fly.io-backed container runtime behind the Deployments app. Stateless: no database, its
only state is the S3-compatible bucket. All configuration is environment variables — see
[`.env`](./.env), which documents every one of them.

## Entrypoints

| File | Used by |
| --- | --- |
| `src/server.ts` | `pnpm start` / `pnpm dev` / the e2e workflows — owns the listener |
| `src/vercel.ts` | any host that owns its own listener — exports the app, binds nothing |
| `src/index.ts` | Vercel's entrypoint detection — re-exports the built `dist/vercel.mjs` |

`pnpm build` (tsdown) produces both `dist/server.mjs` and `dist/vercel.mjs`. Local development
and CI run the TypeScript directly through tsx and need no build.

## Deploying on Vercel

Project settings:

- **Root directory** `apps/marshal`, with "include source files outside of the root directory"
  enabled (this is a pnpm workspace).
- **Build command** `pnpm run build` — `src/index.ts` imports the artifact it produces.
- **Framework** is declared in [`vercel.json`](./vercel.json) as `elysia`; the function's
  `maxDuration` is declared in `src/index.ts`, where Vercel's builder statically reads it.
- **Deployment Protection must be off** (or carry a bypass) for the production domain. Two
  callers that hold no Vercel credential must reach it: the Hexclave backend on `/v1/*`, and
  the Fly builder machine on `/internal/builds/:id/complete`.
- Attach a **stable custom domain** and set `MARSHAL_PUBLIC_URL` to it. Builder machines call
  back on that URL minutes after the request that started them, so a per-deployment URL would
  break every build the moment a newer deployment replaced it.

Environment: set everything in `.env` that is marked required, plus `MARSHAL_PUBLIC_URL`.
`MARSHAL_PORT` is ignored — the platform owns the listener. Never set `MARSHAL_ALLOW_MOCKS`
in production; without it the mock Fly token and the mock builder both fail closed at startup.

Source uploads never pass through the function: `POST /v1/namespaces/:ns/uploads` returns a
presigned bucket URL that the CLI uploads the tarball to directly.
