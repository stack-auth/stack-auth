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

  Follow these instructions to integrate Stack Auth with Convex.

  <Steps titleSize="h3">
    <Step title="Create or identify the Convex app">
      If the project does not already use Convex, initialize a Convex + Next.js app:

      \`\`\`sh
      npm create convex@latest
      \`\`\`

      When prompted, choose **Next.js** and **No auth**. Stack Auth will provide auth.

      During development, run the Convex backend and the app dev server:

      \`\`\`sh
      npx convex dev
      npm run dev
      \`\`\`
    </Step>

    <Step title="Install and configure Stack Auth">
      Install Stack Auth in the app. If you have not already completed the SDK setup steps above, run the setup wizard:

      \`\`\`sh
      npx @stackframe/stack-cli@latest init
      \`\`\`

      Create or select a Stack Auth project in the dashboard. Copy the Stack Auth environment variables into the app's \`.env.local\` file.

      Also add the same Stack Auth environment variables to the Convex deployment environment in the Convex dashboard.
    </Step>

    <Step title="Configure Convex auth providers">
      Create or update \`convex/auth.config.ts\`:

      \`\`\`ts convex/auth.config.ts
      import { getConvexProvidersConfig } from "@stackframe/js";
      // or: import { getConvexProvidersConfig } from "@stackframe/react";
      // or: import { getConvexProvidersConfig } from "@stackframe/stack";

      export default {
        providers: getConvexProvidersConfig({
          projectId: process.env.STACK_PROJECT_ID, // or process.env.NEXT_PUBLIC_STACK_PROJECT_ID
        }),
      };
      \`\`\`
    </Step>

    <Step title="Connect Convex clients to Stack Auth">
      Update the Convex client setup so Convex receives Stack Auth tokens.

      In browser JavaScript:

      \`\`\`ts
      convexClient.setAuth(stackClientApp.getConvexClientAuth({}));
      \`\`\`

      In React:

      \`\`\`ts
      convexReactClient.setAuth(stackClientApp.getConvexClientAuth({}));
      \`\`\`

      For Convex HTTP clients on the server, pass a request-like token store:

      \`\`\`ts
      convexHttpClient.setAuth(stackClientApp.getConvexHttpClientAuth({ tokenStore: requestObject }));
      \`\`\`
    </Step>

    <Step title="Use Stack Auth user data in Convex functions">
      In Convex queries and mutations, use Stack Auth's Convex integration to read the current user.

      \`\`\`ts convex/myFunctions.ts
      import { query } from "./_generated/server";
      import { stackServerApp } from "../src/stack/server";

      export const myQuery = query({
        handler: async (ctx, args) => {
          const user = await stackServerApp.getPartialUser({ from: "convex", ctx });
          return user;
        },
      });
      \`\`\`
    </Step>

    <Step title="Done!" />
  </Steps>
`;

export const supabaseSetupPrompt = deindent`
  ## Supabase Setup

  <Note>
    This setup covers Supabase Row Level Security (RLS) with Stack Auth JWTs. It does not sync user data between Supabase and Stack Auth. Use Stack Auth webhooks if you need data sync.
  </Note>

  <Steps titleSize="h3">
    <Step title="Create Supabase RLS policies">
      In the Supabase SQL editor, enable Row Level Security for your tables and write policies based on Supabase JWT claims.

      For example, this sample table demonstrates public rows, authenticated rows, and user-owned rows:

      \`\`\`sql
      CREATE TABLE data (
        id bigint PRIMARY KEY,
        text text NOT NULL,
        user_id UUID
      );

      INSERT INTO data (id, text, user_id) VALUES
        (1, 'Everyone can see this', NULL),
        (2, 'Only authenticated users can see this', NULL),
        (3, 'Only user with specific id can see this', NULL);

      ALTER TABLE data ENABLE ROW LEVEL SECURITY;

      CREATE POLICY "Public read" ON "public"."data" TO public
      USING (id = 1);

      CREATE POLICY "Authenticated access" ON "public"."data" TO authenticated
      USING (id = 2);

      CREATE POLICY "User access" ON "public"."data" TO authenticated
      USING (id = 3 AND auth.uid() = user_id);
      \`\`\`
    </Step>

    <Step title="Install Stack Auth and Supabase dependencies">
      If you are starting from scratch with Next.js, you can use Supabase's template and then initialize Stack Auth:

      \`\`\`sh
      npx create-next-app@latest -e with-supabase stack-supabase
      cd stack-supabase
      npx @stackframe/stack-cli@latest init
      \`\`\`

      Add the Supabase environment variables to \`.env.local\`:

      \`\`\`.env .env.local
      NEXT_PUBLIC_SUPABASE_URL=<your-supabase-url>
      NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-supabase-anon-key>
      SUPABASE_JWT_SECRET=<your-supabase-jwt-secret>
      \`\`\`

      Also add the Stack Auth environment variables:

      \`\`\`.env .env.local
      # The project ID is the only client-exposed Stack Auth variable; in Next.js it must
      # be prefixed with NEXT_PUBLIC_. STACK_SECRET_SERVER_KEY is server-only and must
      # NEVER be prefixed or exposed to the client.
      NEXT_PUBLIC_STACK_PROJECT_ID=<your-stack-project-id>
      STACK_SECRET_SERVER_KEY=<your-secret-server-key>
      \`\`\`
    </Step>

    <Step title="Mint Supabase JWTs from Stack Auth users">
      Create a server action that signs a Supabase JWT using the current Stack Auth user ID:

      \`\`\`tsx utils/actions.ts
      'use server';

      import { stackServerApp } from "@/stack/server";
      import * as jose from "jose";

      export const getSupabaseJwt = async () => {
        const user = await stackServerApp.getUser();

        if (!user) {
          return null;
        }

        const token = await new jose.SignJWT({
          sub: user.id,
          role: "authenticated",
        })
          .setProtectedHeader({ alg: "HS256" })
          .setIssuedAt()
          .setExpirationTime("1h")
          .sign(new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET));

        return token;
      };
      \`\`\`
    </Step>

    <Step title="Create a Supabase client that uses the Stack Auth JWT">
      Create a helper that passes the server-generated JWT to Supabase:

      \`\`\`tsx utils/supabase-client.ts
      import { createBrowserClient } from "@supabase/ssr";
      import { getSupabaseJwt } from "./actions";

      export const createSupabaseClient = () => {
        return createBrowserClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          { accessToken: async () => await getSupabaseJwt() || "" },
        );
      };
      \`\`\`
    </Step>

    <Step title="Fetch Supabase data">
      Use the Supabase client from your UI. The RLS policies will decide which rows the user can read based on the Stack Auth user ID embedded in the Supabase JWT.

      \`\`\`tsx app/page.tsx
      'use client';

      import { createSupabaseClient } from "@/utils/supabase-client";
      import { useStackApp, useUser } from "@stackframe/stack";
      import Link from "next/link";
      import { useEffect, useState } from "react";

      export default function Page() {
        const app = useStackApp();
        const user = useUser();
        const supabase = createSupabaseClient();
        const [data, setData] = useState<null | any[]>(null);

        useEffect(() => {
          supabase.from("data").select().then(({ data }) => setData(data ?? []));
        }, []);

        const listContent = data === null
          ? <p>Loading...</p>
          : data.length === 0
            ? <p>No notes found</p>
            : data.map((note) => <li key={note.id}>{note.text}</li>);

        return (
          <div>
            {user ? (
              <>
                <p>You are signed in</p>
                <p>User ID: {user.id}</p>
                <Link href={app.urls.signOut}>Sign Out</Link>
              </>
            ) : (
              <Link href={app.urls.signIn}>Sign In</Link>
            )}
            <h3>Supabase data</h3>
            <ul>{listContent}</ul>
          </div>
        );
      }
      \`\`\`
    </Step>

    <Step title="Done!" />
  </Steps>
`;

export const cliSetupPrompt = deindent`
  ## CLI Setup

  Follow these instructions to authenticate users in a command line application with Stack Auth.

  <Steps titleSize="h3">
    <Step title="Add the CLI auth template">
      Download the Stack Auth CLI authentication template and place it in your project. For Python apps, copy it as \`stack_auth_cli_template.py\`.

      Example project layout:

      \`\`\`text
      my-python-app/
      ├─ main.py
      └─ stack_auth_cli_template.py
      \`\`\`
    </Step>

    <Step title="Prompt the user to log in">
      Import and call \`prompt_cli_login\`. It opens the browser, lets the user authenticate, and returns a refresh token.

      \`\`\`py main.py
      from stack_auth_cli_template import prompt_cli_login

      refresh_token = prompt_cli_login(
        app_url="https://your-app-url.example.com",
        project_id="your-project-id-here",
        publishable_client_key="your-publishable-client-key-here",
      )

      if refresh_token is None:
        print("User cancelled the login process. Exiting")
        exit(1)
      \`\`\`

      You can store the refresh token in a local file or keychain and only prompt the user again when no saved refresh token exists.
    </Step>

    <Step title="Exchange the refresh token for an access token">
      Use the refresh token with Stack Auth's REST API to get an access token.

      \`\`\`py
      def get_access_token(refresh_token):
        access_token_response = stack_auth_request(
          "post",
          "/api/v1/auth/sessions/current/refresh",
          headers={
            "x-stack-refresh-token": refresh_token,
          },
        )

        return access_token_response["access_token"]
      \`\`\`
    </Step>

    <Step title="Fetch the current user">
      Use the access token to call the Stack Auth REST API as the logged-in user.

      \`\`\`py
      def get_user_object(access_token):
        return stack_auth_request(
          "get",
          "/api/v1/users/me",
          headers={
            "x-stack-access-token": access_token,
          },
        )

      user = get_user_object(get_access_token(refresh_token))
      print("The user is logged in as", user["display_name"] or user["primary_email"])
      \`\`\`
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
  const isDefinitelyTanstackStart = mainType === "tanstack-start";
  const isMaybeTanstackStart = isDefinitelyTanstackStart || mainType === "ai-prompt";
  const isDefinitelyVanillaReact = mainType === "react";
  const isMaybeVanillaReact = isDefinitelyVanillaReact || mainType === "ai-prompt";

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
    "tanstack-start": "@stackframe/tanstack-start",
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
      - TanStack Start
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
          - TanStack Start: \`@stackframe/tanstack-start\`
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
        It's now time to connect your code to a Stack Auth project.

        You can either run Stack Auth's dev environment locally, or connect to a production project hosted in the cloud.

        ${isAiPrompt ? deindent`
          If you already use Stack Auth for your product, we recommend you re-use the same project to share your configuration between the two.
        ` : ""}

        <AccordionGroup>
          <Accordion title="Option 1: Running Stack Auth's dev environment (recommended)" defaultOpen>
            First, create a \`stack.config.ts\` configuration file in the root directory of the workspace (or anywhere else):

            \`\`\`ts stack.config.ts
            import type { StackConfig } from "${packageName}";

            // default: show-onboarding, which shows the onboarding flow for this project when Stack Auth starts
            export const config: StackConfig = "show-onboarding";
            \`\`\`

            To run your application with Stack Auth, you can then start the dev environment and set environment variables expected by your application. Stack Auth's CLI has a \`dev\` command does both of these, so let's install it as a dev dependency and wrap your existing \`dev\` script in your package.json:

            \`\`\`sh
            npm i -D @stackframe/stack-cli
            # or: pnpm i -D @stackframe/stack-cli
            # or: yarn add -D @stackframe/stack-cli
            # or: bun add --dev @stackframe/stack-cli
            \`\`\`

            \`\`\`json package.json
            {
              // ...
              "scripts": {
                // ...
                "dev": "stack dev --config-file ./stack.config.ts -- npm run dev:without-stack-auth",
                "dev:without-stack-auth": "<your-existing-dev-script>"
              }
            }
            \`\`\`
          </Accordion>

          <Accordion title="Option 2: Connecting to a production project hosted in the cloud">
            ${isAiPrompt ? deindent`
              Note: If you're an AI agent, and you don't already have the information you need from the Cloud project, you may have to ask the user for help on this step. You can either ask them to provide the environment variables, or just leave them empty for now and ask the user to complete them at the end.
            ` : ""}

            If you'd rather run your development environment on our infrastructure, or you already have an existing product, you can also connect a cloud project.

            This process is slightly different depending on whether you're setting up a frontend or a backend (whether your app can keep a secret key safe or not).

            #### Frontend

            Go to your project's dashboard on [app.stack-auth.com](https://app.stack-auth.com) and get the project ID. You can find it in the URL after the \`/projects/\` part. Copy-paste it into your \`.env.local\` file (or wherever your environment variables are stored):

            ${isAiPrompt ? `${deindent`
              Some projects have the \`requirePublishableClientKey\` config option enabled. In that case, a publishable client key will also be necessary. However, this is extremely uncommon; for most projects this is not true, so don't ask the user for one unless you have confirmation that the publishable client key is required. If it's not required, the project ID is the only environment variable required to use Stack Auth on a client.
            `}\n\n` : ""}\`\`\`.env .env.local
            STACK_PROJECT_ID=<your-project-id>
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

            ${isAiPrompt ? `${deindent`
              If the \`requirePublishableClientKey\` config option is enabled as described above, a publishable client key will also be necessary. Otherwise, these two are the only environment variables required to use Stack Auth on a server.
            `}\n\n` : ""}\`\`\`.env .env.local
            STACK_PROJECT_ID=<your-project-id>
            STACK_SECRET_SERVER_KEY=<your-secret-server-key>
            \`\`\`

            They'll automatically be picked up by the \`StackServerApp\` constructor.
          </Accordion>
        </AccordionGroup>
      </Step>

      ${isMaybeReact ? deindent`
        <Step title="${!isDefinitelyReact ? "React: " : ""}Creating a <StackProvider /> and <StackTheme />">
          In React frameworks, Stack Auth provides \`StackProvider\` and \`StackTheme\` components that should wrap your entire app at the root level.

          ${isMaybeVanillaReact && !isDefinitelyNextjs && !isDefinitelyTanstackStart ? deindent`
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

          ${isMaybeTanstackStart ? deindent`
            ${!isDefinitelyTanstackStart ? "For TanStack Start specifically: " : ""}TanStack Start uses file-based routes. The provider goes inside the root route's \`component\` (the inner React tree), while the document shell stays in \`shellComponent\`. Update \`src/routes/__root.tsx\`:

            \`\`\`tsx src/routes/__root.tsx
            import { StackProvider, StackTheme } from "${isDefinitelyTanstackStart ? packageName : "@stackframe/tanstack-start"}";
            import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
            import type { ReactNode } from "react";
            import { stackClientApp } from "../stack/client";

            export const Route = createRootRoute({
              shellComponent: RootDocument,
              component: RootComponent,
            });

            function RootDocument({ children }: { children: ReactNode }) {
              return (
                <html lang="en" suppressHydrationWarning>
                  <head>
                    <HeadContent />
                  </head>
                  <body>
                    {children}
                    <Scripts />
                  </body>
                </html>
              );
            }

            function RootComponent() {
              return (
                <StackProvider app={stackClientApp}>
                  <StackTheme>
                    <Outlet />
                  </StackTheme>
                </StackProvider>
              );
            }
            \`\`\`

            Do not edit \`src/routeTree.gen.ts\` — it is regenerated automatically by the TanStack Start router from the files under \`src/routes/\`.
          ` : ""}
        </Step>

        <Step title="${!isDefinitelyReact ? "React: " : ""}Add Suspense boundary">
          Stack Auth also provides additional \`useXyz\` React hooks for \`getXyz\`/\`listXyz\` functions. For example, \`useUser\` is like \`getUser\`, but as a suspending React hook.

          To support the suspension, you need to add a suspense boundary around your app.
          
          ${isMaybeVanillaReact && !isDefinitelyNextjs && !isDefinitelyTanstackStart ? deindent`
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

          ${isMaybeTanstackStart ? deindent`
            ${!isDefinitelyTanstackStart ? "In TanStack Start: " : ""}wrap the \`<Outlet />\` in your root route with a \`Suspense\` boundary so the document shell can stream while child routes wait on Stack Auth. Update \`RootComponent\` in \`src/routes/__root.tsx\`:

            \`\`\`tsx src/routes/__root.tsx
            import { Suspense } from "react";
            // ...other imports...

            function RootComponent() {
              return (
                <StackProvider app={stackClientApp}>
                  <StackTheme>
                    <Suspense fallback={<div>Loading...</div>}>
                      <Outlet />
                    </Suspense>
                  </StackTheme>
                </StackProvider>
              );
            }
            \`\`\`
          ` : ""}

          ${isAiPrompt ? deindent`
            Note: If you are an AI agent, make sure to make the loading indicator visually appealing and match the design of your app, instead of the example that just says "Loading...".
          ` : ""}
        </Step>

        ${isMaybeTanstackStart ? deindent`
          <Step title="${!isDefinitelyTanstackStart ? "TanStack Start: " : ""}Add the Stack handler route">
            Stack Auth's auth flows (sign-in, sign-up, OAuth callbacks, password reset, etc.) are rendered by a single \`StackHandler\` component mounted at \`/handler/*\`. In TanStack Start, expose it as a splat file route at \`src/routes/handler/$.tsx\`:

            \`\`\`tsx src/routes/handler/$.tsx
            import { StackHandler } from "${isDefinitelyTanstackStart ? packageName : "@stackframe/tanstack-start"}";
            import { createFileRoute, useLocation } from "@tanstack/react-router";

            export const Route = createFileRoute("/handler/$")({
              ssr: false,
              component: HandlerPage,
            });

            function HandlerPage() {
              const { pathname } = useLocation();
              return <StackHandler fullPage location={pathname} />;
            }
            \`\`\`

            Two TanStack-specific notes:

            - The route is opted out of SSR with \`ssr: false\`. The handler runs browser-only auth flows (cookies, redirects, popups), so rendering it on the server provides no benefit and can fight with hydration. Other routes can opt into or out of SSR per-route the same way.
            - Stack Auth resolves the current user during SSR by reading TanStack Start's request cookies through \`@stackframe/tanstack-start\`'s server context. No extra wiring is required — \`useUser()\` "just works" on both server and client routes as long as \`tokenStore: "cookie"\` is set on \`StackClientApp\`.
          </Step>
        ` : ""}
      ` : ""}

      ${isMaybeBackend && !isDefinitelyNextjs ? deindent`
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
