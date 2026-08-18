import { defineTool } from "eve/tools";
import { z } from "zod";
import { getProjectContext } from "#lib/hexclave-client.ts";

// Fallback context read: the parent normally packs the onboarding website_url
// and product context into the delegation message, but when the message is
// missing a detail this lets the researcher fetch the project's own context
// instead of guessing.
export default defineTool({
  description: "Fetch the Hexclave project's stored context (onboarding answers, website URL, product description) for the given project and branch.",
  inputSchema: z.object({
    project_id: z.string().min(1),
    branch_id: z.string().min(1),
  }),
  async execute(input) {
    return await getProjectContext(input);
  },
});
