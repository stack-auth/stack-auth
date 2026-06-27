import { aiSetupPrompt } from "../ai/unified-prompts/skill-site-prompt-parts/ai-setup-prompt";

function getCliProjectSetupContext(configPath?: string): string {
  if (configPath != null) {
    return `
The Hexclave CLI already created or linked this project to a local Hexclave development environment config file:

\`\`\`text
${configPath}
\`\`\`

Do not create or link another Hexclave project. When the SDK setup instructions mention creating \`hexclave.config.ts\` or wrapping the dev script with \`hexclave dev --config-file\`, use the config file path above.
`;
  }

  return `
The Hexclave CLI already created or linked this project to a hosted Hexclave cloud project and wrote or printed the Hexclave environment variables.

Do not create or link another Hexclave project. Use the existing environment variables in this workspace. If the variables were printed instead of written because the user declined to append them to an env file, tell the user exactly which variables still need to be added.
`;
}

export const createInitPrompt = (web: boolean, configPath?: string) => `=============================
HEXCLAVE SETUP INSTRUCTIONS
=============================

These instructions describe how to set up Hexclave.
${web ? `
First of all, use the full setup prompt below as the source of truth. Do not run the Hexclave CLI initializer unless the user explicitly asks for the CLI workflow.
` : ""}

${getCliProjectSetupContext(configPath)}

Use the full setup guide below as the source of truth, with one important CLI-specific adjustment: the "Setting up the project" step is already complete. Use that section only to understand how the existing config/env files should connect to the SDK wiring; do not ask the user for project IDs or keys that the CLI already generated or linked.

Apply only the sections relevant to this project. For example, do not add Convex, Supabase, or command-line-app authentication unless the existing project already uses that surface or the user explicitly asked for it.

${aiSetupPrompt}
`;
