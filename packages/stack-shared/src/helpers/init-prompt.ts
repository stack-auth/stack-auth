// TODO: Use configPath in the prompt once local emulator is set up:
// Add "npx @stackframe/stack-cli emulator run --config-file ${configPath}" to project dev command
export const createInitPrompt = (web: boolean, configPath?: string) => `=============================
STACK AUTH SETUP INSTRUCTIONS
=============================

These instructions describe how to set up Stack Auth.
${web ? `
First of all, if you have access to a terminal, it is better to use the \`npx @stackframe/stack-cli init\`` : ""}

Install both the Stack Auth skill and the Stack Auth MCP server for the current coding agent. Pick the install scope using this rule: if the project root already contains an agent folder or project-scoped MCP/agent config file (e.g. \`.claude/\`, \`.claude.json\`, \`.agents/\`, \`.cursor/\`, \`.cursor/mcp.json\`, \`.codex/\`, \`.codex/config.toml\`, \`.opencode/\`, \`.windsurf/\`, \`.roo/\`, \`.kilocode/\`, \`.augment/\`, \`.continue/\`, \`.crush/\`, \`.vscode/mcp.json\`), install **per project**; otherwise install **globally** for the detected agent.

### Install the skill

Preferred (one shot — detects the agent and writes to the right place):

\`\`\`sh
npx -y skills add stack-auth/stack-auth --skill stack-auth
\`\`\`

If that command isn't available, fall back to a manual install. Download the canonical skill from \`https://skill.stack-auth.com\` (\`WebFetch\` or \`curl -sSL\`) and write it verbatim to \`<skills-dir>/stack-auth/SKILL.md\`. Do not modify the contents. Create missing parent directories. \`<skills-dir>\` per agent (mirrors \`vercel-labs/skills\`):

| Agent | Project \`<skills-dir>\` | Global \`<skills-dir>\` |
| --- | --- | --- |
| Claude Code | \`.claude/skills\` | \`~/.claude/skills\` (or \`$CLAUDE_CONFIG_DIR/skills\`) |
| Codex | \`.agents/skills\` | \`~/.codex/skills\` (or \`$CODEX_HOME/skills\`) |
| Cursor | \`.agents/skills\` | \`~/.cursor/skills\` |
| opencode | \`.agents/skills\` | \`~/.config/opencode/skills\` |
| Windsurf | \`.windsurf/skills\` | \`~/.codeium/windsurf/skills\` |
| Amp | \`.agents/skills\` | \`~/.config/agents/skills\` |
| Antigravity | \`.agents/skills\` | \`~/.gemini/antigravity/skills\` |
| Cline | \`.agents/skills\` | \`~/.agents/skills\` |
| Roo Code | \`.roo/skills\` | \`~/.roo/skills\` |
| Kilo Code | \`.kilocode/skills\` | \`~/.kilocode/skills\` |
| Augment | \`.augment/skills\` | \`~/.augment/skills\` |
| Continue | \`.continue/skills\` | \`~/.continue/skills\` |
| Crush | \`.crush/skills\` | \`~/.config/crush/skills\` |

For agents not listed, follow their documented skills directory or fall back to \`.agents/skills\` (project) / \`~/.<agent>/skills\` (global).

### Install the MCP server

Server URL: \`https://mcp.stack-auth.com/mcp\` (HTTP transport). Common per-agent config locations:
- Claude Code: run \`claude mcp add --transport http stack-auth https://mcp.stack-auth.com/mcp\` (or edit \`~/.claude.json\`)
- VS Code: run \`code --add-mcp '{"type":"http","name":"stack-auth","url":"https://mcp.stack-auth.com/mcp"}'\`
- Cursor: \`~/.cursor/mcp.json\` (project-scoped: \`.cursor/mcp.json\`)
- Codex CLI: \`~/.codex/config.toml\`
- opencode: \`~/.config/opencode/opencode.json\`

For any other agent, register an HTTP MCP server named \`stack-auth\` pointing at \`https://mcp.stack-auth.com/mcp\` using its standard MCP config file.

For reference, questions, or information on Stack Auth, fetch the docs on https://docs.stack-auth.com via curl or any tools available, or — if the MCP server is registered — call its \`ask_stack_auth\` tool.

## Setup

### 1) Install the package

Run the install command using whatever package manager the project uses (npm, yarn, pnpm, bun):

| Framework | Package |
|-----------|---------|
| Next.js | \`@stackframe/stack\` |
| React | \`@stackframe/react\` |
| Vanilla JS | \`@stackframe/js\` |

### 2) Create the Stack apps

Depending on whether you're on a client or a server, you will want to create stackClientApp or stackServerApp. Some environments, like Next.js, have both, so create both files.

The stack client app has client-level permissions. It contains most of the useful methods and hooks for your client-side code.
The stack server app has full read and write access to all users. It requires STACK_SECRET_SERVER_KEY env variable and should only be used in secure context

In Next.js, env vars are auto-detected (NEXT_PUBLIC_STACK_PROJECT_ID etc.), so the constructor needs no explicit config. For other frameworks, you must pass projectId explicitly using the framework's env var access method. Pass publishableClientKey only if your project is configured to require publishable client keys.

The tokenStore should be "nextjs-cookie" for Next.js, or "cookie" for all other frameworks.

Make sure to set redirectMethod on non next.js frameworks. For example for tanstack router import like so:
import { useNavigate } from '@tanstack/react-router'

\`\`\`ts
// src/stack/client.ts
import { StackClientApp } from "@stackframe/stack"; // or "@stackframe/react" or "@stackframe/js"

export const stackClientApp = new StackClientApp({
  // Next.js: omit projectId/publishableClientKey (auto-detected from NEXT_PUBLIC_ env vars)
  // Other frameworks: pass projectId explicitly, and publishableClientKey only if required by your project. For Vite:
  //   projectId: import.meta.env.VITE_STACK_PROJECT_ID,
  //   publishableClientKey: import.meta.env.VITE_STACK_PUBLISHABLE_CLIENT_KEY,
  tokenStore: "nextjs-cookie", // or "cookie" for non-Next.js,
  // redirectMethod: { useNavigate } // or "window"
});
\`\`\`

If the framework has server-side support (e.g. Next.js), also create a server app:

\`\`\`ts
// src/stack/server.ts
import "server-only";
import { StackServerApp } from "@stackframe/stack";
import { stackClientApp } from "./client";

export const stackServerApp = new StackServerApp({
  inheritsFrom: stackClientApp,
});
\`\`\`

### 3) Wrap your app in a Stack provider

Required for all React based frameworks (including Next.js). \`StackHandler\`, \`useUser\`, and \`useStackApp\` all depend on it — without it you will get "useStackApp must be used within a StackProvider" at runtime. In Next.js, add it to the root \`app/layout.tsx\` around \`{children}\`. In React/Vite, wrap your root component.

\`\`\`tsx
import { StackProvider, StackTheme } from "@stackframe/stack"; // or "@stackframe/react" 
import { stackClientApp } from "../stack/client"; // adjust relative path
\`\`\`

Then wrap the body content:

\`\`\`tsx
return (
  <body>
    <StackProvider app={stackClientApp}>
      <StackTheme>{children}</StackTheme>
    </StackProvider>
  </body>
);
\`\`\`

### 4) Create the Stack handler (if available in framework)

This sets up pages for sign in, sign up, password reset, etc.

\`\`\`tsx
import { StackHandler } from "@stackframe/stack"; // Next.js
// import { StackHandler } from "@stackframe/react"; // React

export default function Handler() {
  return <StackHandler fullPage />;
}
\`\`\`

### 5) Create a Suspense boundary

Suspense is necessary for many stack auth hooks such as useUser to function. Add a loading component with a custom loading indicator for the current project. Don't add if one already exists

For example:
\`\`\`tsx
//src/loading.tsx

export default function Loading() {
  return <p>Loading...</p>
}
\`\`\`

### 6) Link environment variables

This is only necessary if not using local emulator. Ensure these are ignored by git.

Rename the env var keys in .env to match the framework's convention for client-exposed variables. For example, Vite requires VITE_ prefix, Next.js uses NEXT_PUBLIC_, etc. The values should stay the same — only rename the keys.

The required variables are:
- Project ID (e.g. NEXT_PUBLIC_STACK_PROJECT_ID, VITE_STACK_PROJECT_ID, etc.)
- Secret server key: STACK_SECRET_SERVER_KEY (only for frameworks with server-side support, no prefix needed)

The publishable client key (e.g. NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY, VITE_STACK_PUBLISHABLE_CLIENT_KEY, etc.) is only required if your project has publishable client keys enabled as a requirement.

`;
