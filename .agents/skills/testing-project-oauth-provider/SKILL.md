---
name: testing-project-oauth-provider
description: How to drive the project-as-OAuth-provider / MCP auth flow (authorize → hosted consent → code → token → JWKS) end-to-end against a local Hexclave dev environment, including the hosted-handler HTTPS wrinkle, how to obtain a static OAuth client_id, and the local Bulldozer dependency for project creation.
---

# Testing the project OAuth provider / MCP auth flow locally

## Services that must be up
- dashboard `localhost:8101`, backend `localhost:8102`, hosted components `localhost:8109`, mock OAuth provider (dashboard sign-in) — all normally started by the user's `pnpm dev`.
- **Bulldozer JS server on `localhost:8146`** is easy to miss. If it is down, *any* project creation fails with
  `API threw ISE in GET /api/v1/payments/items/team/<id>/analytics_timeout_seconds: fetch failed (ECONNREFUSED)`,
  which makes the whole `apps/e2e` backend suite fail for reasons unrelated to the feature. Start it with
  `cd apps/bulldozer-js && pnpm dev` and re-run; the oauth-provider E2E file then passes (10/10).

## Hosted handler URL is HTTPS by default — blocks any hosted-page redirect locally
The backend derives the hosted handler origin from `NEXT_PUBLIC_HEXCLAVE_HOSTED_HANDLER_DOMAIN_SUFFIX`
(`.localhost:8109` in dev) and always prefixes `https://`, but the hosted-components Vite dev server serves
plain HTTP. Any backend redirect into `/handler/...` (e.g. the OAuth interaction/consent redirect) therefore
lands on `https://<projectId>.localhost:8109` and dies with `ERR_SSL_PROTOCOL_ERROR`.
Workaround: restart the backend with the template variable, which takes precedence:

```bash
cd apps/backend && NEXT_PUBLIC_HEXCLAVE_HOSTED_HANDLER_URL_TEMPLATE='http://{projectId}.localhost:8109/{hostedPath}' pnpm dev
```

Verify with:
`curl -D- -o/dev/null "$AUTH_URL"` → follow the `/oidc/interaction/<uid>` redirect and confirm the second
`location:` is `http://<projectId>.localhost:8109/handler/oauth-provider-interaction?interaction_uid=...`.

## Getting a static client's `client_id`
Static OAuth clients are stored under generated UUID keys in project config and the dashboard does **not**
display the `client_id`. Read it from the **environment-level** config override (dashboard writes there):

```bash
curl -s http://localhost:8102/api/v1/internal/config/override/environment \
  -H "x-stack-project-id: internal" -H "x-stack-access-type: admin" \
  -H "x-stack-super-secret-admin-key: this-super-secret-admin-key-is-for-local-development-only"
```
Keys look like `oauthProvider.clients.<clientId>.displayName`. A test client harness should resolve the id by
display name on every request so dashboard edits don't require restarting the harness. The same endpoint
accepts `PATCH` with `{"config_override_string": "{\"oauthProvider.resources.x\": {...}}"}` for fast setup.

## Test client harness
A small Node server (PKCE S256, token exchange, `createMcpTokenVerifier` from
`/packages/js/dist/mcp.js`) on `localhost:30000` with `/callback` registered as the client's redirect URI is
enough to drive the flow from a real browser and to render the resulting token claims + JWKS verification
result as a page. Useful adversarial variants to expose as separate links: undeclared `resource=`, no PKCE,
`code_challenge_method=plain`.

## Triaging a spinning hosted consent page
If `/handler/oauth-provider-interaction` spins forever, check the backend log for repeated
`GET /api/v1/projects/<id>/oauth-provider/interaction/<uid> 400` with
"You must specify an access level for this Hexclave project" — the page's hand-rolled `fetch` needs
`x-stack-access-type: client` **and** `x-stack-project-id` headers (the SDK adds these automatically; a raw
`fetch` does not). Even after adding them the page may keep re-suspending (`/users/me` refetch loop), so
confirm paint, not just HTTP 200. To check whether the consent UI itself is healthy, temporarily stub
`details` with static data — if it renders, the defect is in the data/auth layer, not the UI.
Sanity-check the environment by opening `internal.localhost:8109/handler/account-settings`: if that renders
while signed in, the hosted app/session is fine and the problem is page-specific.

## Sign-in state AND browser cookie state change the outcome — test a matrix, not a single flow
The provider stores the browser's oidc-provider session uid on the interaction when the authorize request is
created, and `oidc-provider@8`'s `resume` action rejects the completion if the session uid changed in the
meantime (`node_modules/.../oidc-provider/lib/actions/authorization/resume.js` →
`SessionNotFound('interaction session and authentication session mismatch')`). Because hosted sign-in happens
on a *different origin* (`{projectId}.localhost:8109`) than the provider (`localhost:8102`), anything that
rotates or stales the provider `_session` cookie can trigger that rejection. Always run all of:

1. **already signed in** when authorization starts → consent → Approve → token issued;
2. **signed out, clean browser profile** (fresh incognito window — no `localhost:8102` cookies at all) →
   hosted sign-in → consent → Approve → token issued;
3. **signed out after a previous successful authorization in the same browser** (i.e. complete flow 1 or 2,
   then `…:8109/handler/sign-out?after_auth_return_to=%2Fhandler%2Fsign-in`, then start a new authorization
   and sign in again mid-flow). This case has repeatedly dead-ended on
   `interaction session and authentication session mismatch`, even when case 2 passes — hosted sign-out does
   not clear the provider-origin session cookie, so a stale provider session survives into the next
   authorization. Reloading the interaction afterwards shows "Authorization unavailable" (it was consumed),
   so the user must restart from the client.

Practical consequences for testing: **never reuse a browser profile between signed-out runs** if you want to
test the true first-run path — use a new incognito window each time (`ctrl+shift+n`, then
`wmctrl -r :ACTIVE: -b add,maximized_vert,maximized_horz`). Conversely, if a signed-out run fails, re-run it
in a clean profile before calling it a product bug, and re-run it in a dirty profile before calling it fixed;
the two states genuinely behave differently. Confirm the underlying cause in the backend log rather than
trusting the browser page: `grep -n "error_description" /tmp/dev-all.untracked.log` (the friendly
"Authorization unavailable" page now hides `interaction session and authentication session mismatch`, so a
failure that used to be obvious raw JSON is now visually indistinguishable from an expired interaction).

## Diagnosing a session mismatch: read the provider cookies on `/interaction/:uid/done`, not just the error
When a signed-out flow dead-ends, dump the `/done` request/response from the log and look at cookies, e.g.:

```bash
L=$(grep -n "interaction/<uid>/done" /tmp/dev-all.untracked.log | head -1 | cut -d: -f1)
awk -v s=$L 'NR>=s && NR<=s+90' /tmp/dev-all.untracked.log \
  | grep -nE "ERR_HTTP_HEADERS_SENT|set-cookie|_session|cookie:|error_description"
```

Two things to check, because they distinguish "stale session" from "session cookie never stored":

1. **Which `_session*` cookies the browser actually sent.** Locally everything is plain HTTP, and
   oidc-provider writes `_session` with `samesite=none` and *no* `secure` flag, which Chrome refuses to
   store. In practice only the `_session.legacy` cookie survives locally, so any response that *expires*
   `_session.legacy` while only re-issuing `_session` leaves the browser with **no** provider session, and the
   subsequent `/auth/:uid` resume fails with `interaction session and authentication session mismatch` even
   though nothing is "stale". A cookie header containing `_session.legacy=...` but no `_session=...` is the
   tell. This also means a local-only failure may not reproduce over HTTPS — say so explicitly rather than
   asserting a production bug.

   Confirmed locally (Chrome, plain HTTP): after a successful authorization, the only provider cookies stored
   for `localhost:8102` are `_session.legacy` and `_session.legacy.sig` (HttpOnly, no Secure, multi-month
   expiry) — the `SameSite=None` `_session` variant is never stored, so the `.legacy` fallback is what carries
   the SSO session. Verify this in the browser instead of guessing: open DevTools → Application →
   Cookies → `http://localhost:8102` (the log lines usually do not print `set-cookie`). Treat the presence of
   `_session.legacy` with a future expiry as evidence that oidc-provider's default session TTL persistence is
   working.
2. **`ERR_HTTP_HEADERS_SENT` thrown from `apps/backend/src/lib/project-oauth-interaction.ts`.** If the
   completion route flushes the response before the session middleware unwinds (e.g. calling
   `interactionFinished`, which bypasses Koa and calls `res.end()` on the raw node response), the cookie
   state ends up half-applied. The working shape is: `finish()` only *returns* the interaction result, the
   session middleware persists cookies as it unwinds, and only then does the route call
   `oidc.interactionResult(...)` and set the 303 through Koa. This error never reaches the browser (the page still says "Authorization
   unavailable"), so grep for it on every failure: `grep -c ERR_HTTP_HEADERS_SENT /tmp/dev-all.untracked.log`.

Also useful as a cheap check of *which* backend code is live without restarting anything: project providers
render the friendly HTML page only on authorization navigations, so
`curl -s -H 'Accept: text/html' -X POST -d 'grant_type=authorization_code&code=nope' \
  http://localhost:8102/api/v1/projects/internal/oidc/token` must return JSON while
`curl -s -H 'Accept: text/html' http://localhost:8102/api/v1/projects/internal/oidc/auth/does-not-exist`
must return HTML. Next.js dev recompiles the backend in place, so a manual restart is usually unnecessary.

Finally, correlate successes and failures by log line number to prove a regression instead of asserting one:
`grep -n "POST /api/v1/projects/internal/oidc/token 200" /tmp/dev-all.untracked.log` versus
`grep -n "interaction session and authentication session mismatch" /tmp/dev-all.untracked.log` shows exactly
which head last issued a token. `ERR_HTTP_HEADERS_SENT` counts are cumulative across heads in the shared dev
log, so always take a baseline line number (`wc -l /tmp/dev-all.untracked.log`) before a run and count only
matches after it (`awk 'NR><baseline>' … | grep -c ERR_HTTP_HEADERS_SENT`).

## Signed-out flows need a genuinely signed-out browser

Hosted sign-out (`…:8109/handler/sign-out?after_auth_return_to=%2Fhandler%2Fsign-in`) can take a while to
take effect; if you navigate to the client's `/start` URL too quickly the old hosted session is still live and
the flow silently skips sign-in — which makes a "signed out" test vacuous (visible in the log as
`interaction/<uid>` → `307` → `/done` with no `:8109/handler/sign-in` and no `localhost:8114` hop). Either
wait until the sign-in page has actually rendered *and* re-check, or use a brand-new incognito window, which
is guaranteed signed out. Same rule for the trusted-client "forces login then skips consent" case.

## Dashboard save path vs direct config PATCH
Direct `PATCH`es to `/api/v1/internal/config/override/{environment,branch}` can return `{"success":true}`
while the *effective* project config (what `project.useConfig()` and the authorize endpoint read) is
unchanged — authorize then answers `invalid_client`. Configure resources/clients through the dashboard
UI's "Save changes" instead; that writes UUID-keyed entries such as
`oauthProvider.clients.<uuid> = {displayName, trusted, redirectUris:{...}}` at the environment level. Note the
older dot-path keys (e.g. `oauthProvider.clients.demo-mcp-client.displayName`) may linger with `null` values;
ignore them and resolve clients by `displayName`.

## Consent is re-prompted for an already-granted client
Re-running the same client/resource after a successful Approve shows the consent screen again (the grant
is not silently reused), so a single untrusted client can be used repeatedly for both approve and deny demos.

## Devin Secrets Needed
None. Local admin key above is the standard dev value; dashboard sign-in uses GitHub OAuth → mock provider →
`admin@example.com`.
