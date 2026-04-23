// TODO: Use configPath in the prompt once local emulator is set up:
// Add "npx @stackframe/stack-cli emulator run --config-file ${configPath}" to project dev command
export const createInitPrompt = (web: boolean, configPath?: string) => `=============================
STACK AUTH SETUP INSTRUCTIONS
=============================

These instructions describe how to set up Stack Auth.
${web ? `
First of all, if you have access to a terminal, it is better to use the \`npx @stackframe/stack-cli init\`` : ""}

Install mcp server from https://mcp.stack-auth.com if not already installed

For reference, questions, or information on Stack Auth, you can query the docs on https://docs.stack-auth.com via curl or any tools that you have

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

Required for all frameworks (including Next.js). \`StackHandler\`, \`useUser\`, and \`useStackApp\` all depend on it — without it you will get "useStackApp must be used within a StackProvider" at runtime. In Next.js, add it to the root \`app/layout.tsx\` around \`{children}\`. In React/Vite, wrap your root component.

\`\`\`tsx
import { StackProvider, StackTheme } from "@stackframe/stack";
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
