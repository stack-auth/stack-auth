# Growth agent evals

Smoke evals for the growth agent, run with eve's eval runner:

```bash
cd apps/growth-agent
pnpm exec eve eval                 # boots a local dev server and runs all evals
pnpm exec eve eval data-analyst-smoke
```

## These are manual/nightly evals — never CI-blocking

Every eval here drives the real root agent, which means:

- **A live model is required.** The root `agent/agent.ts` points at a real model (no `mockModel` fixture), so runs consume tokens and need model credentials (Vercel AI Gateway or the configured provider).
- **A live Hexclave backend is required.** The subagents' tools call the `internal/growth-agent` API, so `HEXCLAVE_GROWTH_BACKEND_URL` and `HEXCLAVE_GROWTH_AGENT_API_SECRET` must point at a running dev backend (`pnpm dev` at the repo root). Evals skip themselves cleanly when these are unset, so an accidental CI invocation stays green — but a skip proves nothing.
- **Results are model-dependent.** Hard gates are limited to behavior we consider contractual (the delegation to the frozen `data-analyst` subagent id); tool-call attempts inside the child are tracked as soft assertions.

Run them by hand after changing subagent instructions/tools, or wire them into a nightly job. Do not add them to a blocking CI pipeline.
