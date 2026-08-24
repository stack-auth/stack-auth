import { defineSandbox } from "eve/sandbox";
import { growthSandboxBackend } from "#lib/sandbox-backend.ts";

// Declared subagents do NOT share the root sandbox. The explicit backend pin
// currently sends both hosted and local runs to Vercel Sandbox. This sandbox is
// scratch space for drafting only, so its Vercel network policy denies egress
// and preserves the same data-exfiltration boundary as the data analyst.
export default defineSandbox({
  backend: growthSandboxBackend({
    docker: { networkPolicy: "deny-all" },
    vercel: { networkPolicy: "deny-all" },
  }),
});
