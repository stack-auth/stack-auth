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

For example:

\`\`\`ts
// src/stack/client.ts
import { StackClientApp } from "@stackframe/stack";

export const stackClientApp = new StackClientApp({
  tokenStore: "nextjs-cookie", // or "cookie"
});
\`\`\`

and/or

\`\`\`ts
// src/stack/server.ts
import "server-only";
import { StackServerApp } from "@stackframe/stack";
import { stackClientApp } from "./client";

export const stackServerApp = new StackServerApp({
  inheritsFrom: stackClientApp,
});
\`\`\`

### 3) Create the Stack handler (if available in framework)

This sets up pages for sign in, sign up, password reset, etc.

\`\`\`tsx
import { StackHandler } from "@stackframe/stack"; // Next.js
// import { StackHandler } from "@stackframe/react"; // React

export default function Handler() {
  return <StackHandler fullPage />;
}
\`\`\`

### 4) Create a Suspense boundary

Suspense is necessary for many stack auth hooks such as useUser to function. Add a loading component with a custom loading indicator for the current project. Don't add if one already exists

For example:
\`\`\`tsx
//src/loading.tsx

export default function Loading() {
  return <p>Loading...</p>
}
\`\`\`

### 5) Link environment variables

This is only necessary if not using local emulator. Ensure these are ignored by git.

\`\`\`
NEXT_PUBLIC_STACK_PROJECT_ID=
NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY=
STACK_SECRET_SERVER_KEY=
\`\`\`

### 6) React only: Wrap the entire page in a Stack provider

This is used for the useUser and useStackApp hooks.

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
`;

