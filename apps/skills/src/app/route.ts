import { skillSitePrompt } from "../../../../packages/shared/src/ai/unified-prompts/skill-site-prompt";
import { createSkillPageRoute } from "../skill-page";

export const { GET, HEAD } = createSkillPageRoute({
  tabTitle: "Hexclave Skill",
  heading: "The Hexclave Agent Skill",
  description: "The Hexclave agent skill — user management, auth, payments, emails, analytics, and the Hexclave CLI.",
  ledeHtml: `This endpoint serves the canonical <span translate="no">SKILL.md</span> that teaches coding agents how to wire Hexclave into a project — auth, orgs, payments, emails, analytics, and the <span translate="no">hexclave-cli</span>.`,
  setupPrompt: {
    blurb: "Copy the canonical setup prompt into your coding agent. It contains the current Hexclave setup instructions and links back to this skill for follow-up questions.",
    text: "https://docs.hexclave.com/guides/getting-started/setup",
  },
  skillMarkdown: skillSitePrompt,
});
