import { StackAssertionError } from "../utils/errors";
import { deindent } from "../utils/strings";

export function getSdkSetupPrompt(mainType: "ai-prompt" | "nextjs" | "react" | "python" | "js" | "tanstack-start" | "nodejs", extraOptions: { tanstackQuery: boolean }) {
  if (mainType !== "ai-prompt") throw new StackAssertionError(`Not yet implemented`);
  return deindent`
    # Setting up Stack Auth

    This prompt explains how to set up Stack Auth in your project.

    To use it, you can use the sections below to set up Stack Auth in the project. For example, if you are setting up a Svelte project, you would follow the SDK setup instructions for a frontend JS project.

    ## SDK Setup Instructions

    Follow these instructions in order to set up and get started with the Stack Auth SDK in various languages. Not all steps are applicable to every type of application; for example, React apps have some extra steps that are not needed with other frameworks.

    The frameworks and languages with explicit SDK support are:

    - Next.js
    - React
    - Other JS & TS (both frontend and backend)

    ### Install dependencies

    Stack Auth has SDKs for various languages, frameworks, and libraries. Use the most specific package each, so, for example, even though a Next.js project uses both Next.js and React, use the Next.js package. If a programming language is not supported entirely, you may have to use the REST API to interface with Stack Auth.

    #### JavaScript & TypeScript

    For JS & TS, the following packages are available:

    - Next.js: \`@stackframe/stack\`
    - React: \`@stackframe/react\`
    - Other & vanilla JS: \`@stackframe/js\`

    To install the correct JavaScript Stack Auth SDK into your project, run the following command:

    \`\`\`sh
    npm i <the-sdk-from-above>
    # or: pnpm i <the-sdk-from-above>
    # or: yarn add <the-sdk-from-above>
    # or: bun add <the-sdk-from-above>
    \`\`\`

    ### Initializing the Stack App

    Next, let us create the Stack App object for your project. This is the most important object in a Stack Auth project.

    For the frontend, you can use the \`StackClientApp\`:

    \`\`\`ts src/stack/client.ts
    import { StackClientApp } from "@stackframe/js";  // use the correct package that you installed in the first step

    export const stackClientApp = new StackClientApp({
      tokenStore: "cookie", // "nextjs-cookie" for Next.js, "cookie" for other web frontends, null for backend environments
    });
    \`\`\`

    For the backend, you can create a \`StackServerApp\` object:

    \`\`\`ts src/stack/server.ts
    import { StackServerApp } from "@stackframe/js";  // use the correct package that you installed in the first step

    export const stackServerApp = new StackServerApp({
      tokenStore: null,
    });
    \`\`\`

    For frameworks that are both front- and backend, like Next.js: You can create a \`StackServerApp\` from a \`StackClientApp\` object:

    \`\`\`ts src/stack/server.ts
    import { StackServerApp } from "@stackframe/stack";  // use the correct package that you installed in the first step
    import { stackClientApp } from "./client";

    export const stackServerApp = new StackServerApp({
      inheritsFrom: stackClientApp,
    });
    \`\`\`

    Note that the secret server key should **never** be exposed to the client, as it can be used to read and write everything in your Stack Auth project. In web frontends or bundled applications, you should therefore always only ever create a \`StackClientApp\` object.

    ### Setting up the project

    It's now time to create a development setup for Stack Auth.

    You can either run Stack Auth locally, or connect to a project hosted in the cloud. If you're unsure, running Stack Auth locally is a good start unless you know you're in an environment where this is not supported.

    If you already use Stack Auth for your product, we recommend you re-use the same project.

    #### Running Stack Auth locally

    This is the recommended way for most users. It also lets you configure Stack Auth locally with a \`stack.config.ts\` file. First, create the config file in the root directory of the workspace (or anywhere else):

    \`\`\`ts stack.config.ts
    import type { StackConfig } from "@stackframe/js";  // use the correct package that you installed in the first step

    // show-onboarding: When the local emulator starts, show the onboarding flow for this project
    export const config: StackConfig = "show-onboarding";
    \`\`\`

    To run Stack Auth locally, you need to start the emulator and set the environment variables. The \`emulator run\` CLI command does both of these, so you can simply wrap your existing \`dev\` script:

    \`\`\`json package.json
    {
      // ...
      "scripts": {
        // ...
        "dev": "npx @stackframe/stack-cli emulator run --config-file ./stack.config.ts -- <your-existing-dev-script>"
      }
    }
    \`\`\`

    #### Connecting a cloud project

    <Note>
      If you're an AI agent, and you don't already have the information you need from the Cloud project, you may have to ask the user for help on this step. You can either ask them to provide the environment variables, or just leave them empty for now and ask the user to complete them at the end.
    </Note>

    If you'd rather run your development environment on our infrastructure, or you already have an existing product, you can also connect a cloud project.

    This process is slightly different depending on whether you're setting up a frontend or a backend (whether your app can keep a secret key safe or not).

    ##### Frontend

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


    ##### Backend (or both frontend and backend)

    First, navigate to the [Project Keys](https://app.stack-auth.com/projects/-selector-/project-keys) page in the Stack Auth dashboard and generate a new set of keys.

    Then, copy-paste them into your \`.env.local\` file (or wherever your environment variables are stored):

    \`\`\`.env .env.local
    STACK_PROJECT_ID=<your-project-id>  # if desired, prefix with your framework's convention for client-exposed variables (e.g. NEXT_PUBLIC_, VITE_, etc.)
    STACK_SECRET_SERVER_KEY=<your-secret-server-key>
    \`\`\`

    They'll automatically be picked up by the \`StackServerApp\` constructor.


    ### React: Creating a \`<StackProvider />\` and \`<StackTheme />\`

    For React specifically, we provide \`StackProvider\` and \`StackTheme\` components that should wrap your entire app at the root level. These components make sure that the built-in React components work correctly.

    For example, if you have an \`App.tsx\` file, this may look like this:

    \`\`\`tsx src/App.tsx
    import { StackProvider, StackTheme } from "@stackframe/react";  // use the correct package that you installed in the first step
    import { stackClientApp } from "@/stack/client";

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

    For Next.js specifically: You can do this in the \`layout.tsx\` file in the \`app\` directory:

    \`\`\`tsx src/app/layout.tsx
    import { Suspense } from "react";
    import { StackProvider, StackTheme } from "@stackframe/stack";  // use the correct package that you installed in the first step
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

    For React specifically: You can do this in the \`App.tsx\` file:


    ### React: Add Suspense boundary

    For React specifically, Stack Auth provides additional \`useXyz\` equivalents for \`getXyz\`/\`listXyz\` functions. For example, \`useUser\` is like \`getUser\`, but as a synchronous React hook that suspends.

    To support the suspension, you need to add a Suspense boundary around your app. The easiest way to do this is to just wrap your entire app in a \`Suspense\` component:

    \`\`\`tsx src/app/layout.tsx
    import { Suspense } from "react";
    import { StackProvider, StackTheme } from "@stackframe/react";  // use the correct package that you installed in the first step
    import { stackServerApp } from "@/stack/server";

    export default function RootLayout({ children }: { children: React.ReactNode }) {
      return (
        <Suspense fallback={<div>Loading...</div>}>
          <StackProvider app={stackServerApp}>
            <StackTheme>
              {children}
            </StackTheme>
          </StackProvider>
        </Suspense>
      );
    }
    \`\`\`

    If you are using Next.js, you can also just provide a \`loading.tsx\` file in the \`app\` directory for the same effect:

    \`\`\`tsx src/app/loading.tsx
    export default function Loading() {
      return <div>Loading...</div>;
    }
    \`\`\`

    If you are an AI agent, make sure to make the loading indicator visually appealing and match the design of your app, instead of the example that just says "Loading...".


    ### Backend: Update callers with header & get user

    You are now ready to use the Stack Auth SDK. If you have any frontends calling your backend endpoints, you may want to pass along the Stack Auth in a header such that you can access the same user object on your backend.

    The most ergonomic way to do this is to pass the result of \`stackClientApp.getAuthorizationHeader()\` as the \`Authorization\` header into your backend endpoints:

    \`\`\`ts
    // NOTE: This is your frontend's code
    const response = await fetch("/my-backend-endpoint", {
      headers: {
        "Authorization": await stackClientApp.getAuthorizationHeader(),
      },
    });
    // ...
    \`\`\`

    <Note>
      Make sure that HTTP caching is disabled with \`Cache-Control: private, no-store\` for authenticated backend endpoints.
    </Note>

    In most backend frameworks you can then access the user object by passing the request object as a \`tokenStore\` of the functions that access the user object:

    \`\`\`ts
    // NOTE: This is your backend's code
    const user = await stackServerApp.getUser({ tokenStore: request });
    return new Response("Hello, " + user.displayName);
    \`\`\`

    This will work as long as \`request\` is an object that follows the shape \`{ headers: Record<string, string | null> | { get: (name: string) => string | null } }\`.

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
    return new Response("Hello, " + user.displayName);
    \`\`\`
  `;
}
