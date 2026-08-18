import { defineSandbox } from "eve/sandbox";
import { growthSandboxBackend } from "#lib/sandbox-backend.ts";

// Declared subagents do NOT share the root sandbox. The explicit backend pin
// currently sends both hosted and local runs to Vercel Sandbox. All data access
// flows through authored tools; this sandbox is scratch space only, so its
// Vercel network policy denies egress and preserves the analyst's boundary.
export default defineSandbox({
  backend: growthSandboxBackend({
    docker: { networkPolicy: "deny-all" },
    vercel: { networkPolicy: "deny-all" },
  }),
});
