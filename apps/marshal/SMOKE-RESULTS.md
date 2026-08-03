# Marshal smoke test results

Validation of the load-bearing Fly.io assumptions from the implementation plan, run against
the real Fly API (maintainer's personal org) and the real R2 bucket on 2026-08-03. Scripts in
`smoke/` (run from `apps/marshal` with `.env.local` present: `node smoke/01-network-flycast.mjs`
etc. — `smoke/99-cleanup.mjs` deletes every `hxc-smoke-*` Fly resource and all `marshal-smoke/`
bucket objects; always run it last). All resources were deleted at the end of the session.

## Confirmed as planned

- **Custom 6PN networks isolate tenants.** `POST /v1/apps` accepts `network`; both
  `<app>.flycast` and `<app>.internal` are NXDOMAIN from a machine on a different network in
  the same org. Machines-API `exec` (`{command: [...], timeout}`) works and is how we probed.
- **Flycast is deterministic and wakes stopped machines.** `allocateIpAddress(type:
  private_v6, network: <net>)` at app creation → `<app>.flycast` immediately routable.
  A request to an autostopped machine cold-starts it in **~1.5 s** (nginx).
- **Autostop/autostart/soft_limit** as machine-level `services[].{autostop, autostart,
  concurrency.soft_limit}` all accepted; an idle machine stopped by itself after ~7 min.
- **Machine lifecycle**: create ~1–2 s; in-place config update returns a new `instance_id`
  (pass it to `/wait`); `machines/{id}/metadata` GET/POST endpoints work for revision tags;
  stop→stopped ~1.7 s, start→started ~1.5 s.
- **Build pipeline works exactly as designed.** Ephemeral machine from `moby/buildkit:latest`
  (2 shared CPUs / 2 GB), script injected via `config.files[].raw_value` (base64) + `init.exec`,
  tarball fetched from R2 over public HTTPS, `buildctl build --frontend dockerfile.v0` pushed
  `registry.fly.io/<app>:<tag>` with basic auth `x:<org token>` — **~85 s** end to end for a
  trivial Dockerfile including image pulls (no cache). `auto_destroy: true` destroyed the
  machine on exit and **logs remain readable after destruction** via the logs API.
- **Deploy from digest**: machine created from `registry.fly.io/<app>@sha256:...` runs and
  serves through flycast. `HEAD /v2/<app>/manifests/<tag>` returns `docker-content-digest`.
- **Registry GC is available**: `DELETE /v2/<app>/manifests/<digest>` → 202, tag gone (404)
  afterwards. (Plan had punted this as unknown; it just works with the org token.)
- **Logs API cursors**: `?instance=<machine_id>` filter works; `meta.next_token` is a
  **nanosecond timestamp**; a *synthesized* token (`millis * 1e6`) pages from that point in
  time, so the contract's `since_millis ⇄ next_token` mapping works with no state. Page size
  is 100 entries. ~7-day retention (not re-verified; nothing old enough).
- **R2**: presigned PUT/GET, `ListObjectsV2` prefix listing, DeleteObject, public-URL GET all
  fine. **Conditional writes work** (`If-None-Match: "*"` → 412 on existing key), giving us an
  atomic claim primitive.
- **Rate/latency**: Machines API ~100–1500 ms per call (create ~1–2 s), GraphQL ~200–2500 ms
  (addCertificate is the slowest at ~2.5 s), logs ~150–300 ms. 20 parallel machine reads and
  10 parallel log reads all returned 200 — no rate limiting observed at that burst size.

## Deviations — plan amended

1. **Logs API auth scheme**: `Authorization: Bearer <token>` → **401**. It requires the raw
   macaroon scheme, `Authorization: FlyV1 fm2_...` (the token verbatim). Machines REST and
   GraphQL accept both. Also: logs for a nonexistent app → 401, not 404.
2. **Fly does NOT enforce hostname uniqueness across apps.** `addCertificate` for a hostname
   already certified on a *different* app (same org) **succeeds**; the "Hostname already exists
   on app" `UNPROCESSABLE` error only fires re-adding to the *same* app. The plan's "Fly
   enforces the 409" decision is wrong. → Marshal enforces uniqueness itself with a bucket
   domain registry (`domains/<hostname>.json`) claimed via conditional PUT (verified above);
   conflicting claim → 409.
3. **App-scoped deploy tokens cannot be minted with the org token**:
   `createLimitedAccessToken` → `UNAUTHORIZED`. v1 uses the org token as the builder's
   registry credential (the plan's fallback; org = trust boundary per decision #7). Hardening
   path: client-side macaroon attenuation, or minting during org provisioning.
4. **Presigned PUT constraints are not enforced by R2**: an upload with a *different*
   content-type than signed still succeeded, and S3-style presigned PUTs can't cap object
   size at all. `max_bytes` is therefore advisory on the slot and enforced at consume time
   (builder checks Content-Length before download; backend already caps tarball size).
5. **`/wait` timeout must be ≤ 60 s** — `timeout=120` → 400. Loop `/wait` calls for longer
   waits.
6. **Digest extraction**: don't scrape build logs for the digest (fragile — busybox sed ate
   it in the smoke run). The harness parses `buildctl --metadata-file` JSON
   (`containerimage.digest`) and reports it via the completion webhook; registry
   `HEAD /v2/<app>/manifests/<tag>` is the fallback resolver.

## GraphQL signatures pinned (introspected)

- `allocateIpAddress(input: {appId, type: v4|v6|private_v6|shared_v4, network?, region?})` —
  `shared_v4` returns `app.sharedIpAddress` (no `ipAddress` node) and is released by `ip`
  string; `v6`/`private_v6` return nodes released by `ipAddressId`.
- `addCertificate(appId, hostname)` / `deleteCertificate(appId, hostname)` — top-level args,
  not input objects. Cert fields used: `configured, acmeDnsConfigured, clientStatus, check,
  dnsValidationHostname, dnsValidationTarget, isApex, issued { nodes { type expiresAt } }`.
  `clientStatus` starts as `"Awaiting configuration"`; `dnsValidationTarget` is the
  `_acme-challenge` CNAME target (`<hostname>.<id>.flydns.net.`).

## Real-Fly QA of Marshal itself (post-implementation)

After implementation, Marshal proper was run once against real Fly + real R2 (env id
"smoke", mock-free except the completion webhook, which can't reach a laptop from Fly's
network — it was delivered manually with an empty body, which also exercised the
registry-HEAD digest fallback). Result: PUT → real builder machine → BuildKit build →
registry push → digest resolve → machine rollout → **state running, instances 1**, runtime
logs proxied, durable build log persisted (100 lines) with no credential leaked. Two real-API
divergences were found and fixed:

1. **The registry push target app must exist before the push** — `registry.fly.io` rejects
   pushes for unknown apps with "app repository not found". Marshal now ensures the service
   app (+ its network and flycast IP) exists BEFORE spawning the builder, not after the build.
2. **GraphQL reads on nonexistent apps return a "Could not find App" error**, not a null
   `app` (which is what the fly-mock naively did). The client treats all-not-found error
   responses as empty on read paths.

Still untested against real Fly: webhook delivery from the builder machine (needs a publicly
reachable Marshal — validated implicitly on the first staging deploy) and the harness's
failure-path webhook. All QA resources (apps `hxc-smoke-builder`, `hxc-s-smokens2-*`; bucket
objects under `specs/uploads/builds/smokens2`) were deleted afterwards; the org lists no apps.

## Not validated (accepted risks)

- Full cert issuance with a real DNS-configured domain (needs a domain we control; staging QA).
- Fly's documented soft limits (apps/org, app-create rate) and sustained logs-API rate limits —
  on the Fly-conversation agenda; burst probes above showed no throttling.
- `flyctl deploy --build-only --push` / Depot builders (future perf upgrade, not v1).
- Bucket lifecycle rules — the smoke bucket is shared with another project, so no lifecycle
  config was written; the dedicated prod bucket needs an `uploads/` expiry rule at setup time.
