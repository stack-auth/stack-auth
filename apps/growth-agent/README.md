# @hexclave/growth-agent

The Eve agent app powering the Growth app: it receives run dispatches from the Hexclave backend, analyzes customer project data, and writes findings, reports, briefs, and action items back through the backend's `internal/growth-agent` API.

Built on the [eve](https://eve.dev) agent framework.

## Requirements

- Node.js 24.x (eve requires `node >= 24`).
- Vercel Sandbox credentials for local development when `HEXCLAVE_GROWTH_SANDBOX_BACKEND=vercel`.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `HEXCLAVE_GROWTH_BACKEND_URL` | Base URL of the Hexclave backend (dev value committed in `.env`: `http://localhost:8102`). The client appends `/api/latest/internal/growth-agent`. |
| `HEXCLAVE_GROWTH_AGENT_API_SECRET` | Shared service secret. Used both to verify inbound bearer tokens from the backend and as the outbound bearer token to the backend. |
| `HEXCLAVE_GROWTH_MODEL` | Optional Vercel AI Gateway model id override (defaults to `zai/glm-5.2`). Use `xai/grok-4.5` as the manual quality fallback if a GLM run fails; do not use OpenRouter's `z-ai/glm-5.2` namespace here. See the routing decision in `agent/agent.ts`. |
| `HEXCLAVE_GROWTH_PROVIDER_ORDER` | Optional comma-separated list of Vercel AI Gateway **provider** slugs to try in order for the selected model (defaults to `wafer,zai`). Set it to route around a degraded provider without a deploy. Slugs currently serving glm-5.2: `wafer`, `zai`, `alibaba`, `digitalocean`, `fireworks`. Note the measured spread is smaller than the catalog's headline tps suggests — Wafer benchmarked ~1.35x over `alibaba` on real runs (~80 vs ~59 tok/s), not ~8x. |
| `HEXCLAVE_GROWTH_REASONING` | Optional reasoning effort for every growth model call: `provider-default`, `none`, `minimal`, `low`, `medium`, `high`, `xhigh`. **Defaults to `none`.** Note this generic field has NO effect on `zai/*` models — the gateway only translates effort levels for OpenAI/Anthropic/Google/Bedrock. glm-5.2's reasoning is disabled by the provider-native `thinking: {type:"disabled"}` option, which `getGrowthModelConfig()` always sends; this var matters only if you point `HEXCLAVE_GROWTH_MODEL` at a non-Z.AI model. To restore reasoning on glm-5.2 you must edit `GROWTH_THINKING_PROVIDER_OPTIONS` in `agent/lib/model.ts`. An unrecognised value throws. |
| `VERCEL_TOKEN`, `VERCEL_TEAM_ID`, `VERCEL_PROJECT_ID` | Explicit Vercel Sandbox credentials for local development when the backend is pinned to `vercel`. Vercel deployments normally authenticate automatically through `VERCEL_OIDC_TOKEN` (OIDC must be enabled for the project). |
| `AGENT_BROWSER_SNAPSHOT_ID` | Optional but strongly recommended in production: a pre-built Vercel sandbox snapshot with Chromium + agent-browser installed, for sub-second browser-VM startup (create once via `createAgentBrowserSnapshot()` from `@agent-browser/sandbox/vercel`). Without it, each `browse-page` call cold-installs Chromium (~30s). |

## Environment files

eve loads `.env` and `.env.local` from the app root (it does not read `.env.development`). Committed dev defaults live in `.env`; put machine-local secrets in `.env.local`.

## Development

```sh
pnpm dev  # eve dev on port ${NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX:-81}47 (default 8147)
```

## HTTP surface

Custom channel routes are mounted by eve at the authored path verbatim (no `/eve/v1/<channel>` prefix). All routes require `Authorization: Bearer $HEXCLAVE_GROWTH_AGENT_API_SECRET`.

- `POST /runs/analysis-phase` — ack `{ accepted: true }`, run in background
- `POST /runs/daily-brief` — ack `{ accepted: true }`, run in background
- `POST /interview` — 501 (Phase 7)
- `POST /chat` — 501 (Phase 9)

eve's own framework routes (session API, health) remain available under `/eve/v1/*`, e.g. `GET /eve/v1/health`.
