import { SmartRequestAuth } from "@/route-handlers/smart-request";
import { tool } from "ai";
import { z } from "zod";

/**
 * Tool for updating/creating dashboard source code.
 *
 * This tool does NOT execute server-side - it returns the tool call to the caller,
 * who is responsible for rendering the dashboard code in a sandbox.
 */
export function updateDashboardTool(auth: SmartRequestAuth | null) {
  return tool({
    description: "Update the dashboard with new source code. The source code must define a React functional component named 'Dashboard' (no props). It runs inside a sandboxed iframe with React, Recharts, DashboardUI, and stackServerApp available as globals. No imports, exports, or require statements.",
    inputSchema: z.object({
      content: z.string().describe("The complete updated JSX source code for the Dashboard component"),
    }),
  });
}
