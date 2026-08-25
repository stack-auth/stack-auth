# Running Hexclave on Railway

This directory is a self-contained Railway integration layer. It is deliberately
**additive**: nothing under `apps/`, `packages/`, or `docker/server/` is modified,
so merging upstream Hexclave changes never conflicts with Railway support.

The one exception is a single line added to `vitest.workspace.ts` to register the
tests in this directory.

## What it does

The Hexclave self-host image runs two servers — the Elysia backend on
`BACKEND_PORT` (8102) and the Next.js dashboard on `DASHBOARD_PORT` (8101).
Railway routes a domain to exactly one target port, so a deployment previously
needed extra services to work around that. This layer removes them:

| File | Replaces |
| --- | --- |
| `proxy.mjs` | A separate Caddy service that path-routed `/api/*` to the backend and everything else to the dashboard |
| `cron.mjs` + `cron-schedule.mjs` | A separate cron service curling a hand-written list of internal endpoints |
| `entrypoint.sh` | Hand-set variables for values Railway already provides |

The result is one Railway service, behind one domain, with no cross-service
network hop for ordinary traffic.

### `proxy.mjs`

Binds Railway's `PORT` and routes `/api/*` to the backend, everything else to the
dashboard — the same split the Caddy service used, so an existing
`NEXT_PUBLIC_HEXCLAVE_API_URL` pointing at the bare origin stays valid.

Two improvements over the Caddy configuration it replaces:

- **The health endpoint is real.** `/__railway/health` returns 200 only when both
  upstreams answer, and the backend probe uses `/health?db=1` so database
  connectivity is verified rather than just "the process is listening". Caddy's
  health path returned a static `ok`, which meant Railway reported a deployment
  healthy while the application behind it was still migrating or had crashed.
- **Forwarded headers are preserved and appended to**, not overwritten, so the
  backend still sees the real client IP, scheme, and host from Railway's edge.

It has no npm dependencies, because it is layered onto a prebuilt image whose
`node_modules` belongs to the application.

### `cron.mjs`

Hexclave's scheduled work runs on Vercel Cron in the hosted product. Self-hosting
has no scheduler, so these endpoints have to be driven externally.

The schedule is read from `apps/backend/vercel.json` — **the same file the backend
itself imports** (`apps/backend/src/server/cron-monitor.ts`). That matters: a
hand-maintained list of endpoints silently goes stale whenever upstream changes
the schedule. That had already happened here — the previous cron service fired
three of the five configured jobs, so `workflow-engine-step` and
`growth-watchdog-step` never ran at all.

Firings send `User-Agent: vercel-cron/1.0` alongside the `CRON_SECRET` bearer
token, which is what `cron-monitor.ts` looks for before opening a Sentry check-in.
Self-hosted crons therefore produce the same monitoring signal as the hosted
product instead of running unobserved.

Runs never overlap: a job still in flight is skipped rather than started again.
This matters for `workflow-engine-step`, which is scheduled every minute but may
use its full 800-second budget.

## Building the image

The overlay is a thin layer on an already-built server image, so it builds in
seconds rather than paying for a full monorepo build:

```bash
docker build -f docker/railway/Dockerfile \
  --build-arg BASE_IMAGE=yourrepo/server:dev \
  -t yourrepo/server-railway:dev .
```

`.github/workflows/docker-railway-build-push.yaml` does this automatically after
`Docker Server Build and Push` succeeds, building against that exact commit's base
image and publishing `${DOCKER_REPO}/server-railway`.

> **Both workflows need GitHub Actions enabled on the fork**, plus the
> `DOCKER_REPO`, `DOCKER_USER`, and `DOCKER_PASSWORD` secrets. Forks have Actions
> disabled by default — check the repository's Actions tab before expecting an
> image to appear.

## Railway service settings

Point the service at `${DOCKER_REPO}/server-railway:<tag>` and set:

| Setting | Value |
| --- | --- |
| Healthcheck path | `/__railway/health` |
| `RAILWAY_HEALTHCHECK_TIMEOUT_SEC` | `900` |
| `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` | `30` |

The long healthcheck timeout is not optional on a first deploy: the entrypoint
runs migrations and the seed script before either server binds, which on a large
database takes minutes. Railway's 300-second default will fail the deploy while
it is still legitimately working. The proxy serves a "starting up" page during
this window rather than a raw error.

There is no `railway.json` in this repository on purpose. Config-as-code only
applies to services Railway builds from a repository, and this deploys a prebuilt
image, so a committed `railway.json` would silently do nothing.

## Variables

Set these:

| Variable | Notes |
| --- | --- |
| `HEXCLAVE_SERVER_SECRET` | Required. Generate with `pnpm generate-keys`. |
| `CRON_SECRET` | Required for scheduled jobs. Without it the entrypoint logs a warning and no cron runs. |
| `NEXT_PUBLIC_HEXCLAVE_API_URL` | Only when using a custom domain — see below. |
| `NEXT_PUBLIC_HEXCLAVE_DASHBOARD_URL` | Only when using a custom domain — see below. |

These are derived automatically and should **not** be set:

| Variable | Derived from |
| --- | --- |
| `HEXCLAVE_DATABASE_CONNECTION_STRING` | Railway Postgres's `DATABASE_URL` |
| `NEXT_PUBLIC_HEXCLAVE_API_URL` | `RAILWAY_PUBLIC_DOMAIN` |
| `NEXT_PUBLIC_HEXCLAVE_DASHBOARD_URL` | `RAILWAY_PUBLIC_DOMAIN` |
| `HEXCLAVE_TRUSTED_PROXY` | Defaults to `generic` for the Railway edge |

Derivation never overrides a value you set explicitly, in either the `HEXCLAVE_`
or the legacy `STACK_` spelling.

> **Deploying a second service against an already-seeded database** (a staging
> copy, or a test service alongside a running one): set
> `HEXCLAVE_SKIP_SEED_SCRIPT=true`. The seed script tries to rewrite the internal
> project's environment config overrides and aborts with `Environment
> configuration overrides cannot be changed in a development environment`, which
> takes the whole container down with it. Migrations still run and are a no-op on
> an up-to-date database. The trade-off is that the new service's domain is not
> added as a trusted domain automatically, so add it in the dashboard.

> **Custom domains:** `RAILWAY_PUBLIC_DOMAIN` is not reliably your custom domain,
> so set `NEXT_PUBLIC_HEXCLAVE_API_URL` and `NEXT_PUBLIC_HEXCLAVE_DASHBOARD_URL`
> explicitly to it (both to the same origin — the proxy serves both from one port).
> Note that `NEXT_PUBLIC_HEXCLAVE_DASHBOARD_URL` is added as a trusted domain by
> the seed script.

Hexclave dual-reads `HEXCLAVE_*` and `STACK_*` names and **fails to start if the
two spellings of one setting disagree**. Set one spelling per setting, not both.

## Opting out

| Variable | Effect |
| --- | --- |
| `HEXCLAVE_RAILWAY_DISABLE_PROXY=true` | Skip the proxy and expose `BACKEND_PORT`/`DASHBOARD_PORT` as two domains with explicit target ports. Public-URL derivation is skipped too, since the two would no longer share an origin. |
| `HEXCLAVE_RAILWAY_DISABLE_CRON=true` | Skip the cron runner and silence the missing-`CRON_SECRET` warning. |
| `HEXCLAVE_RAILWAY_CRON_TIMEOUT_MS` | Per-firing timeout. Defaults to 840000 (14 minutes). |
| `HEXCLAVE_RAILWAY_HEALTH_PATH` | Health endpoint path. Defaults to `/__railway/health`. |

## Replicas

The entrypoint runs migrations and the seed script on every start, so scaling
past one replica means concurrent migration runs against the same database. Keep
this service at one replica, or set `HEXCLAVE_RUN_MIGRATIONS=false` and
`HEXCLAVE_RUN_SEED_SCRIPT=false` on the extras and run migrations separately.

## Tests

```bash
pnpm test run --project railway
```

Covers the crontab parser and matching rules, the proxy's routing, health
aggregation and header forwarding (against real sockets), and the entrypoint's
environment derivation.

The `loadCrons` test snapshots the current contents of `apps/backend/vercel.json`.
If an upstream merge changes the cron schedule, that snapshot fails — which is the
point: whoever merges gets to confirm the new job should also run on Railway.

## Fork hygiene

Enabling GitHub Actions on a fork activates every workflow inherited from
upstream, including ones that publish to external registries. These are deleted
on this fork:

| Workflow | Why |
| --- | --- |
| `npm-publish.yaml` | Publishes packages to the public npm registry on every push to `main` |
| `swift-sdk-publish.yaml` | Pushes the Swift SDK to an upstream prerelease repo |
| `dashboard-release.yaml` | Cuts a dashboard release |
| `table-of-contents.yaml` | Pushes generated commits back onto `main`/`dev` |
| `auto-assign.yaml` | Assigns pull requests |
| `reviewers-assignees.yml` | Requests reviews from upstream maintainer accounts |

A fork's workflows run with the fork's own token and cannot write to the parent
repository, so none of these could ever have reached upstream — but they would
publish to shared external registries, which is worse. CI (lint, tests,
migration checks) and the Docker image builds are kept.

If an upstream merge reintroduces any of them, delete them again.
