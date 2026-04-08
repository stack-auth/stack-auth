# docs-mintlify

How to run the Mintlify docs preview locally from this repository.

## Prerequisites

- Node.js `>=20.17.0`
- `pnpm`
- Repository dependencies installed (`pnpm install` from repo root)
- OpenAPI specs in `openapi/` (generated). From the repo root run:

  ```bash
  pnpm run --filter @stackframe/backend codegen-docs
  ```

  That writes `client.json`, `server.json`, `admin.json`, and `webhooks.json` into `docs-mintlify/openapi/` (and into `docs/openapi/` for the legacy docs app). The `openapi/` directory is gitignored here; CI and local `mint validate` expect these files to exist after codegen.

## Run locally

From the repository root:

```bash
pnpm -C docs-mintlify run dev
```

This starts Mintlify in `docs-mintlify` on `http://localhost:${NEXT_PUBLIC_STACK_PORT_PREFIX:-81}04` (for example, `http://localhost:8104` with the default prefix).

From inside `docs-mintlify`, you can also run:

```bash
pnpm dev
```

Useful variants:

```bash
# Override the default port
pnpm -C docs-mintlify run dev -- --port 3333

# Skip OpenAPI processing for faster iteration
pnpm -C docs-mintlify run dev -- --disable-openapi
```

## Search + assistant in local preview

If you want local search and the Mintlify assistant:

```bash
pnpm -C docs-mintlify run login
pnpm -C docs-mintlify run status
```

Then re-run `pnpm -C docs-mintlify run dev`.

## Package scripts

From repo root:

```bash
pnpm -C docs-mintlify run lint
pnpm -C docs-mintlify run typecheck
pnpm -C docs-mintlify run build
pnpm -C docs-mintlify run clean
```

`lint` runs both `mint validate` and `mint broken-links`.
