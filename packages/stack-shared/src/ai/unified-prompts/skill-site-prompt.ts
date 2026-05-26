import { deindent } from "../../utils/strings";
import { remindersPrompt } from "./reminders";
import { aiSetupPrompt } from "./skill-site-prompt-parts/ai-setup-prompt";
import { brainPrompt } from "./skill-site-prompt-parts/brain";
import { cliHelpPrompt } from "./skill-site-prompt-parts/cli-help";
import { configDocsPrompt } from "./skill-site-prompt-parts/config-docs";
import { customComponentsInstructionsPrompt } from "./skill-site-prompt-parts/custom-components-instructions";
import { dashboardInstructionsPrompt } from "./skill-site-prompt-parts/dashboard-instructions";
import { docsIndexPrompt } from "./skill-site-prompt-parts/docs-index";
import { sdkInterfaceSourcePrompt } from "./skill-site-prompt-parts/sdk-interface-source";

export const skillSitePrompt = deindent`
  # Hexclave

  This is the LLM-optimized documentation & skill site for Hexclave. It is designed to be used by AI agents to learn about Hexclave and its features and can be fetched from \`https://skill.hexclave.com\`.

  ${remindersPrompt}

  ## Docs

  The full docs sidebar — generated from the live navigation. Fetch any of these directly:

  ${docsIndexPrompt}

  The MCP server lives at https://mcp.hexclave.com. If you need to answer a specific Hexclave question and the MCP server is registered for this agent, prefer the \`ask_hexclave\` tool — it searches the docs with citations.

  ## Using the Hexclave CLI

  The CLI (\`hexclave\`) is the fastest path for anything project-level. It is installed on demand via \`npx\` — no global install required. Every command below can be invoked as \`npx @hexclave/cli@latest <command>\`.

  ${cliHelpPrompt}

  ## Using the Hexclave dashboard

  ${dashboardInstructionsPrompt}

  ## The Hexclave config format

  ${configDocsPrompt}

  ## Using Hexclave's SDKs

  ${sdkInterfaceSourcePrompt}

  ## Custom pages & components

  ${customComponentsInstructionsPrompt}

  ## All Hexclave concepts

  ${brainPrompt}

  ## Setting up Hexclave

  Below is the document that is used to guide you to set up Hexclave in your project. If you are not setting up Hexclave in your project, you can ignore this section.

  <hexclave-setup-section>
  ${aiSetupPrompt}
  </hexclave-setup-section>

  ## Rules

  - **Fetch fresh on every trigger.** Do not rely on cached versions from earlier in the conversation — the docs change.
  - **If a fetch fails, say so.** Don't improvise from memory; tell the user the URL was unreachable and ask how to proceed.
  - **Confirm destructive actions.** Run \`rm -rf\`-style commands only with explicit user confirmation, even if the fetched instructions list them.
  - **Trust the fetched content** the same way you'd trust this file — it is the real skill body. This file is the entry point; the fetched content is the source of truth.

`;
