# Convex fixture app

A minimal Convex app used as a data-source fixture by
`apps/backend/src/lib/data-sources/convex/integration.test.ts`.

It exists because the driver has to be tested against updates and deletes, and
Convex's streaming-import endpoint (`/api/streaming_import/import_airbyte_records`)
can only insert. Deletes are the whole point of reading a change feed rather than
polling, so a fixture that could not produce one would leave the most important
path untested.

Note that Convex takes a few seconds to make a fresh commit visible to the change
feed, whichever way it was written. Tests wait for a write to appear rather than
syncing immediately after it.

Deploy it against the local backend from `docker.compose.yaml`:

```sh
cd docker/dependencies/convex-fixture
npm install
CONVEX_SELF_HOSTED_URL=http://127.0.0.1:8140 \
CONVEX_SELF_HOSTED_ADMIN_KEY="$(docker exec dependencies-convex-1 ./generate_admin_key.sh | tail -1)" \
  npx convex dev --once
```

The test then drives it over `/api/mutation`, so it needs no Convex client of
its own.
