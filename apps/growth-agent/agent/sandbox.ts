import { defineSandbox } from "eve/sandbox";
import { growthSandboxBackend } from "#lib/sandbox-backend.ts";

// Every environment currently uses the explicit backend selected in
// #lib/sandbox-backend.ts; local development is pinned to Vercel in .env. The
// root sandbox is scratch space only, so its Vercel backend keeps the default
// network policy.
export default defineSandbox({
  backend: growthSandboxBackend({
    docker: { networkPolicy: "deny-all" },
    // Left at Vercel's default rather than an explicit policy, unlike the three
    // subagent sandboxes. Carried over verbatim from the previous config: this
    // file's egress claim has only ever covered the local backend.
    vercel: {},
  }),
});
