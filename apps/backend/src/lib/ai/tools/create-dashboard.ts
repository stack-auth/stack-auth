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
    description: "Replace the entire dashboard source. Use ONLY for initial creation or large structural rewrites that touch most of the file. For any change smaller than ~30% of the file, use patchDashboard instead. The source must define a React functional component named 'Dashboard' (no props). Runs in a sandboxed iframe with React, Recharts, DashboardUI, and stackServerApp as globals. No imports, exports, or require statements.",
    inputSchema: z.object({
      content: z.string().describe("The complete updated JSX source code for the Dashboard component"),
    }),
  });
}

/**
 * Tool for surgical edits to the existing dashboard source.
 *
 * Like updateDashboardTool, this is inert server-side - the call streams back to the
 * client, which applies the patches against currentTsxSource and updates state.
 */
export function patchDashboardTool(auth: SmartRequestAuth | null) {
  return tool({
    description: "Apply one or more surgical text edits to the existing dashboard source. Prefer this over updateDashboard for any change smaller than ~30% of the file (rename, restyle, add/remove a single component, fix one bug). Each edit is a literal find-and-replace on the current source. Returns nothing - the client applies the patch.",
    inputSchema: z.object({
      edits: z.array(z.object({
        oldText: z.string().min(1).describe("Exact substring to find in the current source. Must match verbatim including whitespace. Include enough surrounding context to make the match unique, OR set occurrenceIndex when oldText repeats."),
        newText: z.string().describe("Replacement text. Empty string deletes the match."),
        occurrenceIndex: z.number().int().min(0).optional().describe("0-indexed match to replace when oldText appears multiple times. Omit when oldText is unique in the source."),
      })).min(1).max(20).describe("Edits applied in order against the running source. Later edits see the result of earlier ones."),
    }),
  });
}
