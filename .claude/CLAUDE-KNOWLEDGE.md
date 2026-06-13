## Q: How should nested cross-domain auth preserve hosted sign-in return state?

A: Preserve the return state on the OAuth `redirect_uri` itself. When hosted sign-in starts a nested cross-domain handoff, copy `after_auth_return_to` and the `hexclave_cross_domain_*` params onto the nested OAuth redirect URI, while stripping nested-only `stack_nested_cross_domain_auth_*` params from URLs that continue after the handoff. The nested OAuth request must still generate its own fresh OAuth `state`/PKCE pair on the target domain; do not reuse `hexclave_cross_domain_state`, because that verifier belongs to the initiating app domain.

## Q: How should the demo development server run through the CLI without racing package dev watchers?

A: Do not run `pnpm -w run cli` from `examples/demo` dev. That root script invokes Turbo builds, and package builds remove `dist/` before writing, which can race with the root dev package watchers. The demo should run the CLI from TypeScript source with auto-update disabled and set `HEXCLAVE_CLI_DEV_DASHBOARD_COMMAND` to `pnpm --dir apps/dashboard run dev:rde-production`, which builds and starts an isolated standalone dashboard closer to the packaged RDE runtime. It must also set `STACK_API_URL`/`STACK_DASHBOARD_URL` to the local dev ports; otherwise the CLI intentionally falls back to production. The CLI still owns the development-environment env vars, including `HEXCLAVE_DASHBOARD_NEXT_DIST_DIR`, so the dashboard build uses an isolated `.next` output directory without duplicating env setup in demo scripts.

## Q: How should hosted components behave when a project requires publishable client keys?

A: Hosted components are first-party project handler pages and may not have a customer app publishable key available. Backend client-auth checks should allow keyless/sentinel requests from the same project's hosted handler origin, while still rejecting arbitrary missing or invalid keys from non-hosted origins.

## Q: What should the hosted-components app send when loading a project that requires publishable client keys?

A: The hosted-components app should construct its `StackClientApp` with `publishableClientKeyNotNecessarySentinel`. General client requests such as `/projects/current` only send the publishable-client-key header when the app has a configured key; relying on auth-specific sentinel fallbacks is not enough, because hosted sign-in can otherwise suspend on project/user loads before the auth flow starts.

## Q: Should request API URL fallback logging fire for non-cloud request hosts?

A: No. `getApiUrlForHost()` maps known Hexclave/Stack cloud sibling hosts to canonical API hosts, and all other hosts are legitimate fallback cases for localhost, previews, self-host, and custom domains. Return `NEXT_PUBLIC_STACK_API_URL` silently rather than capturing `request-api-url.fallback` errors.

## Q: Where do `hexclave dev` dashboard process logs go?

A: The app command passed after `hexclave dev -- ...` inherits the terminal stdio, but the development-environment dashboard process is detached and writes stdout/stderr to the per-port log path recorded in `~/.stack/dev-envs.json`, such as `~/.stack/rde-dashboard-9342.log`. The CLI should print `Dashboard logs: <path>` when it starts or reuses that dashboard.

## Q: Where should development-environment dashboard lifecycle startup live?

A: Do not import the remote-development-environment manager from `apps/dashboard/src/instrumentation.ts`. Next/Turbopack builds an Edge instrumentation bundle too, and it can statically follow even guarded dynamic imports, pulling Node-only `fs`/`path`/`os` dependencies into Edge and crashing or warning on page loads. Start the lifecycle from Node-only RDE routes or manager entry points, such as session registration, instead.

## Q: How should `hexclave dev` prevent package-manager child processes from being orphaned?

A: Commands such as `pnpm --dir examples/demo run dev:inner` spawn the real server as a grandchild, so signaling only the direct `pnpm` child can leave `next dev` listening on the app port. Start app commands in their own process group on Unix, forward SIGINT/SIGTERM to the group, and schedule a short SIGKILL fallback. Because macOS/Node has no parent-death signal equivalent to Linux `PR_SET_PDEATHSIG`, wrap the app command in a tiny watcher that polls the `hexclave dev` parent PID and kills the app process group if that parent disappears. Wrappers that launch the CLI, such as the demo dev-retry script, should also signal the CLI process group rather than only the direct child PID.

## Q: What should the RDE debug page show?

A: `/rde-debug` should be RDE-only and browser-secret authenticated, but it should bypass the development-environment health gate so it remains reachable when the dashboard would otherwise show the paused/unhealthy screen. Keep it server-rendered in the Node runtime and show compact live process state: active sessions and heartbeat ages/TTLs, config file watchers, pending sync timers, sync errors, synchronous update locks, local dashboard process/log entries, pending browser confirmation code metadata, and project/config mappings. Do not expose long-lived secrets.

## Q: How should hosted cross-domain sign-out return to the initiating app?

A: The redirect planner already preserves `after_auth_return_to` when sending a user to a cross-domain `signOut` handler, but the sign-out page must also consume that parameter. Pass the handler's parsed search params into `SignOut` and call `user.signOut({ redirectUrl: after_auth_return_to })`. If there is no user on the handler domain, treat sign-out as already complete and replace the browser location with `after_auth_return_to` instead of falling through to the handler domain's default signed-out/sign-in flow.
