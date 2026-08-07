import { getPublicEnvVar } from "@/lib/env";
import { remindersPrompt } from "@hexclave/shared/dist/ai/unified-prompts/reminders";
import { deindent } from "@hexclave/shared/dist/utils/strings";

const PROD_DOCS_BASE_URL = "https://docs.hexclave.com";
const PROD_API_BASE_URL = "https://api.hexclave.com";

export function getSetupDocsBaseUrl(): string {
  return getPublicEnvVar("NEXT_PUBLIC_STACK_DOCS_BASE_URL") ?? PROD_DOCS_BASE_URL;
}

export function getManualSetupDocsUrl(): string {
  const docsBaseUrl = getSetupDocsBaseUrl().replace(/\/$/, "");
  return `${docsBaseUrl}/guides/getting-started/setup`;
}

export function getOnboardingRemindersPrompt(): string {
  const docsBaseUrl = getSetupDocsBaseUrl().replace(/\/$/, "");
  return remindersPrompt.replaceAll(PROD_DOCS_BASE_URL, docsBaseUrl);
}

/** Rough LLM estimate used for onboarding prompt previews (~1 token / 4 chars). */
export function estimatePromptTokenCount(text: string): number {
  return Math.max(1, Math.round(text.length / 4));
}

export function formatApproximateTokenCountLabel(text: string): string {
  return `~${estimatePromptTokenCount(text).toLocaleString("en-US")} tokens`;
}

export function getSetupApiBaseUrl(): string {
  return getPublicEnvVar("NEXT_PUBLIC_STACK_API_URL") ?? PROD_API_BASE_URL;
}

export function buildCloudSetupPrompt(options: {
  docsBaseUrl: string,
  projectId: string,
  apiBaseUrl: string,
}): string {
  const { docsBaseUrl, projectId, apiBaseUrl } = options;
  const normalizedDocsBaseUrl = docsBaseUrl.replace(/\/$/, "");
  const reminders = remindersPrompt.replaceAll(PROD_DOCS_BASE_URL, normalizedDocsBaseUrl);

  // The SDK already defaults to the production cloud API. Only tell the agent
  // to configure an API URL when this deployment actually uses a custom one.
  const isDefaultApiBaseUrl = apiBaseUrl === PROD_API_BASE_URL;
  const projectValues = isDefaultApiBaseUrl
    ? deindent`
      - Hexclave project ID: ${projectId}
    `
    : deindent`
      - Hexclave API URL: ${apiBaseUrl}
      - Hexclave project ID: ${projectId}
    `;
  const envVarInstructions = isDefaultApiBaseUrl
    ? deindent`
      Create the framework-specific public environment variable for the Hexclave project ID. For example, Next.js uses NEXT_PUBLIC_HEXCLAVE_PROJECT_ID, while Vite-based frameworks use VITE_HEXCLAVE_PROJECT_ID. If the Hexclave docs for this framework specify a different environment variable name, use the docs' framework-specific name with the value above.
    `
    : deindent`
      Create the framework-specific public environment variables for the Hexclave API URL and project ID. For example, Next.js uses NEXT_PUBLIC_HEXCLAVE_API_URL and NEXT_PUBLIC_HEXCLAVE_PROJECT_ID, while Vite-based frameworks use VITE_HEXCLAVE_API_URL and VITE_HEXCLAVE_PROJECT_ID. If the Hexclave docs for this framework specify different environment variable names, use the docs' framework-specific names with the values above.
    `;

  return deindent`
    Install and set up Hexclave in this project by following these instructions:

    Read https://skill.hexclave.com and follow the setup instructions it gives for this project's specific framework and language.

    Follow skill.hexclave.com as written, but make sure to use the cloud setup, not the local dashboard setup.

    Do not change the dev script in package.json. In cloud setup, there's no need for that.

    Use these Hexclave project values when creating environment variables:

    ${projectValues}

    ${envVarInstructions}

    After setup finishes, verify that the Hexclave MCP server is registered in your AI client config — name: \`hexclave\`, transport: \`http\`, URL: \`https://mcp.hexclave.com/mcp\`. If it is not registered, add it manually so future agents have live access to Hexclave docs and APIs.

    Once setup is done, tell me to add the Hexclave secret server key from the dashboard to my environment file. After that, setup is complete.

    ${reminders}
  `;
}

export function buildCliDevSetupPrompt(options: {
  docsBaseUrl: string,
}): string {
  const { docsBaseUrl } = options;
  const normalizedDocsBaseUrl = docsBaseUrl.replace(/\/$/, "");
  const reminders = remindersPrompt.replaceAll(PROD_DOCS_BASE_URL, normalizedDocsBaseUrl);

  return deindent`
    Install and set up Hexclave in this project by following these instructions:

    Read https://skill.hexclave.com and follow the setup instructions it gives for this project's specific framework and language.

    Follow skill.hexclave.com as written, but use the local dashboard / Hexclave CLI development setup. Do not use the cloud environment-variable setup for local development.

    Set up the app's dev command so Hexclave starts through the CLI:

    \`\`\`json
    {
      "scripts": {
        "dev": "hexclave dev --config-file ./hexclave.config.ts -- npm run dev:inner",
        "dev:inner": "<the app's previous dev command>"
      }
    }
    \`\`\`

    If the Hexclave CLI is not installed globally, use \`npx @hexclave/cli dev --config-file ./hexclave.config.ts -- npm run dev:inner\` instead.

    Do not create Hexclave project keys or ask for Hexclave environment variables for local development. The \`hexclave dev\` command automatically creates or links the local config project and injects the project ID and secret server key into the child app process.

    Keep project configuration in \`hexclave.config.ts\`. Once setup is done, run \`npm run dev\` and create the first user in the app.

    After setup finishes, verify that the Hexclave MCP server is registered in your AI client config — name: \`hexclave\`, transport: \`http\`, URL: \`https://mcp.hexclave.com/mcp\`. If it is not registered, add it manually so future agents have live access to Hexclave docs and APIs.

    ${reminders}
  `;
}
