import { workflowsSkillSitePrompt } from "../../../../../packages/shared/src/ai/unified-prompts/skill-site-prompt";
import { createSkillPageRoute } from "../../skill-page";

// This static segment must resolve before the dynamic `/[toolName]` MCP-tool
// proxy: Next.js matches literal segments ahead of dynamic ones, so `/workflows`
// serves the skill page rather than being treated as an MCP tool name.
export const { GET, HEAD } = createSkillPageRoute({
  tabTitle: "Hexclave Workflows Skill",
  heading: "The Hexclave Workflows Skill",
  description: "The full Hexclave agent skill plus everything specific to the Workflows app — triggers, steps, and how to hand a workflow to the dashboard.",
  ledeHtml: `This endpoint serves the full Hexclave <span translate="no">SKILL.md</span> followed by the deeper Workflows material — writing durable handlers with <span translate="no">step.run</span>, the trigger catalog, and why workflow source is pasted into the dashboard rather than committed to config.`,
  // Like Deployments, Workflows has no getting-started docs page of its own, so
  // the prompt points the agent back at this URL.
  setupPrompt: {
    blurb: "Copy this prompt into your coding agent. It points the agent at this page, which carries the full Hexclave skill plus everything needed to write a workflow.",
    text: "Read https://skill.hexclave.com/workflows and use it to write a Hexclave workflow for this project",
  },
  skillMarkdown: workflowsSkillSitePrompt,
});
