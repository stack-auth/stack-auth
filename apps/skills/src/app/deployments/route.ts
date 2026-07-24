import { deploymentsSkillSitePrompt } from "../../../../../packages/shared/src/ai/unified-prompts/skill-site-prompt";
import { createSkillPageRoute } from "../../skill-page";

// This static segment must resolve before the dynamic `/[toolName]` MCP-tool
// proxy: Next.js matches literal segments ahead of dynamic ones, so `/deployments`
// serves the skill page rather than being treated as an MCP tool name.
export const { GET, HEAD } = createSkillPageRoute({
  tabTitle: "Hexclave Deployments Skill",
  heading: "The Hexclave Deployments Skill",
  description: "The full Hexclave agent skill plus everything specific to the Deployments app — services, env vars, deploying, and custom domains.",
  ledeHtml: `This endpoint serves the full Hexclave <span translate="no">SKILL.md</span> followed by the deeper Deployments material — configuring services, env vars, deploying with <span translate="no">hexclave deploy</span>, and custom domains.`,
  skillMarkdown: deploymentsSkillSitePrompt,
});
