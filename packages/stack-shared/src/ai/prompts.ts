import { deindent } from "../utils/strings";

export const mcpSetupPrompt = deindent`
  ## MCP Setup

  <Note>
    This prompt is not yet implemented.
  </Note>

  <Steps titleSize="h3">
    <Step title="Install dependencies">
      Install the MCP package:
    </Step>
    <Step title="Done!" />
  </Steps>
`;

export const convexSetupPrompt = deindent`
  ## Convex Setup

  <Note>
    This prompt is not yet implemented.
  </Note>

  <Steps titleSize="h3">
    <Step title="Install dependencies">
      Install the Convex package:
    </Step>
    <Step title="Done!" />
  </Steps>
`;

export const supabaseSetupPrompt = deindent`
  ## Supabase Setup

  <Note>
    This prompt is not yet implemented.
  </Note>

  <Steps titleSize="h3">
    <Step title="Install dependencies">
      Install the Supabase package:
    </Step>
    <Step title="Done!" />
  </Steps>
`;

export const cliSetupPrompt = deindent`
  ## CLI Setup

  <Note>
    This prompt is not yet implemented.
  </Note>

  <Steps titleSize="h3">
    <Step title="Install dependencies">
      Install the CLI package:
    </Step>
    <Step title="Done!" />
  </Steps>
`;

export const aiSetupPrompt = deindent`
  # Setting up Stack Auth

  This prompt explains how to set up Stack Auth in your project.

  To use it, you can use the sections below to set up Stack Auth in the project. For example, if you are setting up a Svelte project, you would follow the SDK setup instructions for a frontend JS project.

  ${getSdkSetupPrompt("ai-prompt")}

  ${mcpSetupPrompt}

  ${convexSetupPrompt}

  ${supabaseSetupPrompt}

  ${cliSetupPrompt}
`;

export function getSdkSetupPrompt(mainType: "ai-prompt" | "nextjs" | "react" | "js" | "tanstack-start" | "nodejs" | "bun") {
  const isDefinitelyReact = mainType === "react" || mainType === "nextjs" || mainType === "tanstack-start";
  const isMaybeReact = isDefinitelyReact || mainType === "ai-prompt";
  const isDefinitelyNextjs = mainType === "nextjs";
  const isMaybeNextjs = isDefinitelyNextjs || mainType === "ai-prompt";

  const isDefinitelyBackend = mainType === "nodejs" || mainType === "bun" || mainType === "nextjs";
  const isMaybeBackend = isDefinitelyBackend || mainType === "js" || mainType === "ai-prompt";
  const isDefinitelyFrontend = isDefinitelyReact;
  const isMaybeFrontend = isDefinitelyFrontend || mainType === "js" || mainType === "ai-prompt";

  const isAiPrompt = mainType === "ai-prompt";

  const typeLabel = {
    "ai-prompt": null,
    nextjs: "Next.js",
    react: "React",
    js: "Other JS/TS",
    "tanstack-start": "Tanstack Start",
    nodejs: "Node.js",
    bun: "Bun",
  }[mainType];
  const packageName = {
    "ai-prompt": "<the-sdk-from-above>",
    nextjs: "@stackframe/stack",
    react: "@stackframe/react",
    js: "@stackframe/js",
    "tanstack-start": "@stackframe/react",
    nodejs: "@stackframe/js",
    bun: "@stackframe/js",
  }[mainType];

  return deindent`
    ## ${typeLabel ? `${typeLabel} SDK Setup Instructions` : "SDK Setup Instructions"}

    Follow these instructions in order to set up and get started with the Stack Auth SDK ${typeLabel ? `for ${typeLabel} ` : "in various languages"}.
    
    ${isAiPrompt ? "Not all steps are applicable to every type of application; for example, React apps have some extra steps that are not needed with other frameworks." : ""}

    ${isAiPrompt ? deindent`
      The frameworks and languages with explicit SDK support are:

      - Next.js
      - React
      - Other JS & TS (both frontend and backend)
    ` : ""}

    <Steps titleSize="h3">
      <Step title="Install dependencies">
        ${isAiPrompt ? deindent`
          Stack Auth has SDKs for various languages, frameworks, and libraries. Use the most specific package each, so, for example, even though a Next.js project uses both Next.js and React, use the Next.js package. If a programming language is not supported entirely, you may have to use the REST API to interface with Stack Auth.

          #### JavaScript & TypeScript

          For JS & TS, the following packages are available:

          - Next.js: \`@stackframe/stack\`
          - React: \`@stackframe/react\`
          - Other & vanilla JS: \`@stackframe/js\`

          You can install the correct JavaScript Stack Auth SDK into your project by running the following command:
        ` : deindent`
          First, install the \`${packageName}\` npm package with your preferred package manager:
        `}

          \`\`\`sh
          npm i ${packageName}
          # or: pnpm i ${packageName}
          # or: yarn add ${packageName}
          # or: bun add ${packageName}
          \`\`\`
      </Step>
      
      <Step title="Initializing the Stack App">
        Next, let us create the Stack App object for your project. This is the most important object in a Stack Auth project.

        ${isMaybeFrontend ? deindent`
          In a frontend where you cannot keep a secret key safe, you would use the \`StackClientApp\` constructor:

          \`\`\`ts src/stack/client.ts
          import { StackClientApp } from "${packageName}";

          export const stackClientApp = new StackClientApp({
            tokenStore: "cookie", // "nextjs-cookie" for Next.js, "cookie" for other web frontends, null for backend environments
          });
          \`\`\`
        ` : ""}

        ${isMaybeBackend ? deindent`
          In a backend where you can keep a secret key safe, you can use the \`StackServerApp\`, which provides access to more sensitive APIs compared to \`StackClientApp\`:

          ${!isDefinitelyFrontend ? deindent`
            \`\`\`ts src/stack/server.ts
            import { StackServerApp } from "${packageName}";

            export const stackServerApp = new StackServerApp({
              tokenStore: null,
            });
            \`\`\`
          ` : ""}

          ${isMaybeFrontend && !isDefinitelyFrontend ? deindent`
            In frameworks that are both front- and backend, like Next.js, you can also create a \`StackServerApp\` from a \`StackClientApp\` object:
          ` : ""}

          ${isMaybeFrontend ? deindent`
            \`\`\`ts src/stack/server.ts
            import { StackServerApp } from "${packageName}";
            import { stackClientApp } from "./client";

            export const stackServerApp = new StackServerApp({
              inheritsFrom: stackClientApp,
            });
            \`\`\`
          ` : ""}

          ${isAiPrompt ? deindent`
            Note that the secret server key should **never** be exposed to the client, as it can be used to read and write everything in your Stack Auth project. In web frontends or bundled applications, you should therefore always only ever create a \`StackClientApp\` object.
          ` : ""}
        ` : ""}
      </Step>

      <Step title="Setting up the project">
        It's now time to create a development setup for Stack Auth.

        You can either run Stack Auth locally, or connect to a project hosted in the cloud.

        ${isAiPrompt ? deindent`
          If you already use Stack Auth for your product, we recommend you re-use the same project to share your configuration between the two.
        ` : ""}

        <AccordionGroup>
          <Accordion title="Option 1: Running Stack Auth locally (recommended)" defaultOpen>
            First, create a \`stack.config.ts\` configuration file in the root directory of the workspace (or anywhere else):

            \`\`\`ts stack.config.ts
            import type { StackConfig } from "${packageName}";

            // default: show-onboarding, which shows the onboarding flow for this project when Stack Auth starts
            export const config: StackConfig = "show-onboarding";
            \`\`\`

            To run your application with Stack Auth, you then need to start the emulator and set environment variables expected by your application. The \`emulator run\` CLI command does both of these, so you can simply wrap your existing \`dev\` script in your package.json:

            \`\`\`json package.json
            {
              // ...
              "scripts": {
                // ...
                "dev": "npx @stackframe/stack-cli emulator run --config-file ./stack.config.ts -- <your-existing-dev-script>"
              }
            }
            \`\`\`
          </Accordion>

          <Accordion title="Option 2: Connecting a cloud project">
            ${isAiPrompt ? deindent`
              Note: If you're an AI agent, and you don't already have the information you need from the Cloud project, you may have to ask the user for help on this step. You can either ask them to provide the environment variables, or just leave them empty for now and ask the user to complete them at the end.
            ` : ""}

            If you'd rather run your development environment on our infrastructure, or you already have an existing product, you can also connect a cloud project.

            This process is slightly different depending on whether you're setting up a frontend or a backend (whether your app can keep a secret key safe or not).

            #### Frontend

            Go to your project's dashboard on [app.stack-auth.com](https://app.stack-auth.com) and get the project ID. You can find it in the URL after the \`/projects/\` part. Copy-paste it into your \`.env.local\` file (or wherever your environment variables are stored):

            \`\`\`.env .env.local
            STACK_PROJECT_ID=<your-project-id>  # if available, prefix with your framework's convention for client-exposed variables (e.g. NEXT_PUBLIC_, VITE_, etc.)
            \`\`\`

            Alternatively, you can also just set the project ID in the \`stack/client.ts\` file:

            \`\`\`ts src/stack/client.ts
            export const stackClientApp = new StackClientApp({
              // ...
              projectId: "your-project-id",
            });
            \`\`\`


            #### Backend (or both frontend and backend)

            First, navigate to the [Project Keys](https://app.stack-auth.com/projects/-selector-/project-keys) page in the Stack Auth dashboard and generate a new set of keys.

            Then, copy-paste them into your \`.env.local\` file (or wherever your environment variables are stored):

            \`\`\`.env .env.local
            STACK_PROJECT_ID=<your-project-id>  # if desired, prefix with your framework's convention for client-exposed variables (e.g. NEXT_PUBLIC_, VITE_, etc.)
            STACK_SECRET_SERVER_KEY=<your-secret-server-key>
            \`\`\`

            They'll automatically be picked up by the \`StackServerApp\` constructor.
          </Accordion>
        </AccordionGroup>
      </Step>

      ${isMaybeReact ? deindent`
        <Step title="${!isDefinitelyReact ? "React: " : ""}Creating a <StackProvider /> and <StackTheme />">
          In React frameworks, Stack Auth provides \`StackProvider\` and \`StackTheme\` components that should wrap your entire app at the root level.

          ${!isDefinitelyNextjs ? deindent`
            For example, if you have an \`App.tsx\` file, update it as follows:

            \`\`\`tsx src/App.tsx
            import { StackProvider, StackTheme } from "${packageName}";
            import { stackClientApp } from "./stack/client";

            export default function App() {
              return (
                <StackProvider app={stackClientApp}>
                  <StackTheme>
                    {/* your app content */}
                  </StackTheme>
                </StackProvider>
              );
            }
            \`\`\`
          ` : ""}

          ${isMaybeNextjs ? deindent`
            ${!isDefinitelyNextjs ? "For Next.js specifically: " : ""}You can do this in the \`layout.tsx\` file in the \`app\` directory:

            \`\`\`tsx src/app/layout.tsx
            import { Suspense } from "react";
            import { StackProvider, StackTheme } from "${packageName}";
            import { stackServerApp } from "@/stack/server";

            export default function RootLayout({ children }: { children: React.ReactNode }) {
              return (
                <StackProvider app={stackServerApp}>
                  <StackTheme>
                    {children}
                  </StackTheme>
                </StackProvider>
              );
            }
            \`\`\`
          ` : ""}
        </Step>

        <Step title="${!isDefinitelyReact ? "React: " : ""}Add Suspense boundary">
          Stack Auth also provides additional \`useXyz\` React hooks for \`getXyz\`/\`listXyz\` functions. For example, \`useUser\` is like \`getUser\`, but as a suspending React hook.

          To support the suspension, you need to add a suspense boundary around your app.
          
          ${!isDefinitelyNextjs ? deindent`
            The easiest way to do this is to just wrap your entire app in a \`Suspense\` component:

            \`\`\`tsx src/App.tsx
            import { Suspense } from "react";
            import { StackProvider, StackTheme } from "${packageName}";
            import { stackClientApp } from "./stack/client";

            export default function App() {
              return (
                <Suspense fallback={<div>Loading...</div>}>
                  <StackProvider app={stackClientApp}>
                    <StackTheme>
                      {/* your app content */}
                    </StackTheme>
                  </StackProvider>
                </Suspense>
              );
            }
            \`\`\`
          ` : ""}

          ${isMaybeNextjs ? deindent`
            In Next.js, this can be easily done by adding a \`loading.tsx\` file in the \`app\` directory:

            \`\`\`tsx src/app/loading.tsx
            export default function Loading() {
              return <div>Loading...</div>;
            }
            \`\`\`
          ` : ""}

          ${isAiPrompt ? deindent`
            Note: If you are an AI agent, make sure to make the loading indicator visually appealing and match the design of your app, instead of the example that just says "Loading...".
          ` : ""}
        </Step>
      ` : ""}

      ${isMaybeBackend ? deindent`
        <Step title="${!isDefinitelyBackend ? "Backend: " : ""}Update callers with header & get user">
          You are now ready to use the Stack Auth SDK. If you have any frontends calling your backend endpoints, you may want to pass along the Stack Auth tokens in a header such that you can access the same user object on your backend.

          The most ergonomic way to do this is to pass the result of \`stackClientApp.getAuthorizationHeader()\` as the \`Authorization\` header into your backend endpoints when the user is signed in:

          \`\`\`ts
          // NOTE: This is your frontend's code
          const authorizationHeader = await stackClientApp.getAuthorizationHeader();
          const response = await fetch("/my-backend-endpoint", {
            headers: {
              ...(authorizationHeader ? { Authorization: authorizationHeader } : {}),
            },
          });
          // ...
          \`\`\`

          In most backend frameworks you can then access the user object by passing the request object as a \`tokenStore\` of the functions that access the user object:

          \`\`\`ts
          // NOTE: This is your backend's code
          const user = await stackServerApp.getUser({ tokenStore: request });
          return new Response("Hello, " + user.displayName, { headers: { "Cache-Control": "private, no-store" } });
          \`\`\`

          This will work as long as \`request\` is an object that follows the shape \`{ headers: Record<string, string | null> | { get: (name: string) => string | null } }\`.

          <Note>
            Make sure that HTTP caching is disabled with \`Cache-Control: private, no-store\` for authenticated backend endpoints.
          </Note>

          If you cannot use \`getAuthorizationHeader()\`, for example because you are using a protocol other than HTTP, you can use \`getAuthJson()\` instead:

          \`\`\`ts
          // Frontend:
          await rpcCall("my-rpc-endpoint", {
            data: {
              auth: await stackClientApp.getAuthJson(),
            },
          });

          // Backend:
          const user = await stackServerApp.getUser({ tokenStore: data.auth });
          return new RpcResponse("Hello, " + user.displayName);
          \`\`\`
        </Step>
      ` : ""}

      <Step title="Done!" />
    </Steps>
  `;
}
