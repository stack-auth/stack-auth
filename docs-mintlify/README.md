# docs-mintlify

How to run the Mintlify docs preview locally from this repository.

## Prerequisites

- Node.js `>=20.17.0`
- `pnpm`
- Repository dependencies installed (`pnpm install` from repo root)

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
