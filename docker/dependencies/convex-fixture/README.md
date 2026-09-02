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

Convex is not a standing dev dependency — nothing in the product talks to it, and
only this test does — so start a backend just for the run, the way the Postgres
data-source integration test does:

```sh
docker run -d --name hexclave-convex-test -p 8140:3210 \
  -e INSTANCE_NAME=hexclave-local -e DISABLE_BEACON=true \
  ghcr.io/get-convex/convex-backend:latest
```

`DISABLE_BEACON` stops the backend reporting anonymized usage to Convex on every
start. Then deploy this app into it:

```sh
cd docker/dependencies/convex-fixture
npm install
CONVEX_SELF_HOSTED_URL=http://127.0.0.1:8140 \
CONVEX_SELF_HOSTED_ADMIN_KEY="$(docker exec hexclave-convex-test ./generate_admin_key.sh | tail -1)" \
  npx convex dev --once
```

Tear it down with `docker rm -f hexclave-convex-test` when you are done.

The test then drives it over `/api/mutation`, so it needs no Convex client of
its own.
