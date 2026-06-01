'use client';

import { CodeBlock } from '@/components/code-block';
import { DesignButton } from "@/components/design-components";
import { APIEnvKeys, NextJsEnvKeys, ViteEnvKeys } from '@/components/env-keys';
import { InlineCode } from '@/components/inline-code';
import { StyledLink } from '@/components/link';
import { CopyPromptButton, Tabs, TabsContent, TabsList, TabsTrigger, Typography, cn } from "@/components/ui";
import { useThemeWatcher } from '@/lib/theme';
import { BookIcon, SparkleIcon, XIcon } from "@phosphor-icons/react";
import { use } from "@hexclave/shared/dist/utils/react";
import { deindent } from '@hexclave/shared/dist/utils/strings';
import dynamic from "next/dynamic";
import Image from 'next/image';
import { Suspense, useRef, useState } from "react";
import type { GlobeMethods } from 'react-globe.gl';
import { PageLayout } from "../page-layout";
import { useAdminApp } from '../use-admin-app';
import { globeImages } from './globe';
import styles from './setup-page.module.css';

const countriesPromise = import('./country-data.geo.json');
const Globe = dynamic(() => import('react-globe.gl').then((mod) => mod.default), { ssr: false });

const commandClasses = "text-red-600 dark:text-red-400";
const nameClasses = "text-green-600 dark:text-green-500";

const INSTALL_COMMAND_BY_FRAMEWORK = {
  nextjs: 'npx @hexclave/cli@latest init',
  tanstackStart: 'npm install @hexclave/tanstack-start',
  react: 'npm install @hexclave/react',
  javascript: 'npm install @hexclave/js',
  python: 'pip install requests',
} as const;

type SetupFramework = keyof typeof INSTALL_COMMAND_BY_FRAMEWORK;

const TANSTACK_START_SETUP_PROMPT = deindent`
  Please set up Hexclave in my TanStack Start app.

  1. Install the alpha TanStack Start package:

  npm install @hexclave/tanstack-start

  2. Configure the app with these environment variables:

  VITE_HEXCLAVE_PROJECT_ID=<project-id>
  HEXCLAVE_SECRET_SERVER_KEY=<secret-server-key>

  3. Create a HexclaveClientApp using @hexclave/tanstack-start with:
  - projectId: import.meta.env.VITE_HEXCLAVE_PROJECT_ID
  - tokenStore: "cookie"
  - redirectMethod: "window"

  4. Wrap the TanStack Start root route with HexclaveProvider and HexclaveTheme.

  5. Add a /handler/$ route using HexclaveHandler. The handler route must set ssr: false and pass location={pathname} from useLocation().

  Use only the environment variables listed above.

  After it finishes, verify that the Hexclave MCP server is registered in your AI client config — name: \`hexclave\`, transport: \`http\`, URL: \`https://mcp.hexclave.com/\`. If it is not registered, please add it manually so you have live access to Hexclave docs and APIs.
`;

const buildInstallPrompt = (framework: SetupFramework) => {
  if (framework === "tanstackStart") {
    return TANSTACK_START_SETUP_PROMPT;
  }

  const command = INSTALL_COMMAND_BY_FRAMEWORK[framework];
  return deindent`
  Please run the following command in my project's terminal:

  ${command}

  After it finishes, verify that the Hexclave MCP server is registered in your AI client config — name: \`stack-auth\`, transport: \`http\`, URL: \`https://mcp.hexclave.com/mcp\`. The command above should handle this automatically; if for any reason it didn't, please add the MCP server manually so you have live access to Hexclave docs and APIs.
`;
};

export default function SetupPage(props: { toMetrics: () => void }) {
  const adminApp = useAdminApp();
  const [selectedFramework, setSelectedFramework] = useState<'nextjs' | 'tanstackStart' | 'react' | 'javascript' | 'python'>('nextjs');
  const [keys, setKeys] = useState<{ projectId: string, publishableClientKey?: string, secretServerKey: string } | null>(null);
  const projectConfig = adminApp.useProject().useConfig();
  const requirePublishableClientKey = projectConfig.project.requirePublishableClientKey;
  const publishableClientKeyValue = keys?.publishableClientKey ?? "...";
  const optionalPublishableClientKeyProp = (indent: string) =>
    requirePublishableClientKey ? `\n${indent}publishableClientKey: "${publishableClientKeyValue}",` : "";
  const optionalPublishableClientKeyHeader = (indent: string) =>
    requirePublishableClientKey ? `\n${indent}'x-hexclave-publishable-client-key': "${publishableClientKeyValue}",` : "";

  const onGenerateKeys = async () => {
    const newKey = await adminApp.createInternalApiKey({
      hasPublishableClientKey: requirePublishableClientKey,
      hasSecretServerKey: true,
      hasSuperSecretAdminKey: false,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365 * 200),
      description: 'Onboarding',
    });

    setKeys({
      projectId: adminApp.projectId,
      publishableClientKey: newKey.publishableClientKey ?? undefined,
      secretServerKey: newKey.secretServerKey!,
    });
  };

  const nextJsSteps = [
    {
      step: 2,
      title: "Install Hexclave",
      content: <>
        <Typography>
          In a new or existing Next.js project, install Hexclave as a dependency into your project:
        </Typography>
        <CodeBlock
          language="bash"
          content={`npx @hexclave/cli@latest init`}
          customRender={
            <div className="p-4 font-mono text-sm">
              <span className={commandClasses}>pnpx</span> <span className={nameClasses}>@hexclave/cli@latest</span> init
            </div>
          }
          title="Terminal"
          icon="terminal"
        />
      </>
    },
    {
      step: 3,
      title: "Create Keys",
      content: <>
        <Typography>
          Put these keys in the <InlineCode>.env.local</InlineCode> file.
        </Typography>
        <HexclaveKeys keys={keys} onGenerateKeys={onGenerateKeys} type="next" />
      </>
    },
    {
      step: 4,
      title: "Done",
      content: <>
        <Typography>
          If you start your Next.js app with npm run dev and navigate to <StyledLink href="http://localhost:3000/handler/signup">http://localhost:3000/handler/signup</StyledLink>, you will see the sign-up page.
        </Typography>
      </>
    },
  ];

  const reactSteps = [
    {
      step: 2,
      title: "Install Hexclave",
      content: <>
        <Typography>
          In a new or existing React project, install Hexclave&apos;s dependencies:
        </Typography>
        <CodeBlock
          language="bash"
          content={`npm install @hexclave/react`}
          customRender={
            <div className="p-4 font-mono text-sm">
              <span className={commandClasses}>npm install</span> <span className={nameClasses}>@hexclave/react</span>
            </div>
          }
          title="Terminal"
          icon="terminal"
        />
      </>
    },
    {
      step: 3,
      title: "Create Keys",
      content: <HexclaveKeys keys={keys} onGenerateKeys={onGenerateKeys} type="raw" />
    },
    {
      step: 4,
      title: "Create stack/client.ts file",
      content: <>
        <Typography>
          Create a new file called <InlineCode>stack/client.ts</InlineCode> and add the following code. Here we use react-router-dom as an example.
        </Typography>
        <CodeBlock
          language="tsx"
          content={deindent`
            import { HexclaveClientApp } from "@hexclave/react";
            import { useNavigate } from "react-router-dom";
            
            export const hexclaveClientApp = new HexclaveClientApp({
              // You should store these in environment variables
              projectId: "${keys?.projectId ?? "..."}",${optionalPublishableClientKeyProp("  ")}
              tokenStore: "cookie",
              redirectMethod: {
                useNavigate,
              }
            });
          `}
          title="stack/client.ts"
          icon="code"
        />
      </>
    },
    {
      step: 5,
      title: "Update App.tsx",
      content: <>
        <Typography>
          Update your App.tsx file to wrap the entire app with a <InlineCode>HexclaveProvider</InlineCode> and <InlineCode>HexclaveTheme</InlineCode> and add a <InlineCode>HexclaveHandler</InlineCode> component to handle the authentication flow.
        </Typography>
        <CodeBlock
          language="tsx"
          maxHeight={300}
          content={deindent`
            import { HexclaveHandler, HexclaveProvider, HexclaveTheme } from "@hexclave/react";
            import { Suspense } from "react";
            import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
            import { hexclaveClientApp } from "./stack/client";

            function HandlerRoutes() {
              const location = useLocation();
              
              return (
                <HexclaveHandler app={hexclaveClientApp} location={location.pathname} fullPage />
              );
            }

            export default function App() {
              return (
                <Suspense fallback={"Loading..."}>
                  <BrowserRouter>
                    <HexclaveProvider app={hexclaveClientApp}>
                      <HexclaveTheme>
                        <Routes>
                          <Route path="/handler/*" element={<HandlerRoutes />} />
                          <Route path="/" element={<div>hello world</div>} />
                        </Routes>
                      </HexclaveTheme>
                    </HexclaveProvider>
                  </BrowserRouter>
                </Suspense>
              );
            }
          `}
          title="App.tsx"
          icon="code"
        />
      </>
    },
    {
      step: 6,
      title: "Done",
      content: <>
        <Typography>
          If you start your React app with npm run dev and navigate to <StyledLink href="http://localhost:5173/handler/signup">http://localhost:5173/handler/signup</StyledLink>, you will see the sign-up page.
        </Typography>
      </>
    }
  ];

  const tanstackStartSteps = [
    {
      step: 2,
      title: "Install Hexclave",
      content: <>
        <Typography>
          In a new or existing TanStack Start project, install the alpha Hexclave package:
        </Typography>
        <CodeBlock
          language="bash"
          content={`npm install @hexclave/tanstack-start`}
          customRender={
            <div className="p-4 font-mono text-sm">
              <span className={commandClasses}>npm install</span> <span className={nameClasses}>@hexclave/tanstack-start</span>
            </div>
          }
          title="Terminal"
          icon="terminal"
        />
      </>
    },
    {
      step: 3,
      title: "Create Keys",
      content: <>
        <Typography>
          Put these keys in your TanStack Start environment file.
        </Typography>
        <HexclaveKeys keys={keys} onGenerateKeys={onGenerateKeys} type="vite" />
      </>
    },
    {
      step: 4,
      title: "Create stack/client.ts file",
      content: <>
        <Typography>
          Create a new file called <InlineCode>src/stack/client.ts</InlineCode> and initialize Hexclave with cookie storage.
        </Typography>
        <CodeBlock
          language="tsx"
          content={deindent`
            import { HexclaveClientApp } from "@hexclave/tanstack-start";

            export const hexclaveClientApp = new HexclaveClientApp({
              projectId: import.meta.env.VITE_HEXCLAVE_PROJECT_ID,
              tokenStore: "cookie",
              redirectMethod: "window",
            });
          `}
          title="src/stack/client.ts"
          icon="code"
        />
      </>
    },
    {
      step: 5,
      title: "Update the root route",
      content: <>
        <Typography>
          Wrap your TanStack Start root route with <InlineCode>HexclaveProvider</InlineCode> and <InlineCode>HexclaveTheme</InlineCode>.
        </Typography>
        <CodeBlock
          language="tsx"
          maxHeight={300}
          content={deindent`
            import { HexclaveProvider, HexclaveTheme } from "@hexclave/tanstack-start";
            import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
            import { hexclaveClientApp } from "../stack/client";

            export const Route = createRootRoute({
              component: RootComponent,
              shellComponent: RootDocument,
            });

            function RootComponent() {
              return (
                <HexclaveProvider app={hexclaveClientApp}>
                  <HexclaveTheme>
                    <Outlet />
                  </HexclaveTheme>
                </HexclaveProvider>
              );
            }

            function RootDocument({ children }: { children: React.ReactNode }) {
              return (
                <html>
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
          `}
          title="src/routes/__root.tsx"
          icon="code"
        />
      </>
    },
    {
      step: 6,
      title: "Add the handler route",
      content: <>
        <Typography>
          Create a splat route for Hexclave&apos;s built-in auth pages.
        </Typography>
        <CodeBlock
          language="tsx"
          content={deindent`
            import { HexclaveHandler } from "@hexclave/tanstack-start";
            import { createFileRoute, useLocation } from "@tanstack/react-router";

            export const Route = createFileRoute("/handler/$")({
              ssr: false,
              component: HandlerPage,
            });

            function HandlerPage() {
              const { pathname } = useLocation();
              return <HexclaveHandler fullPage location={pathname} />;
            }
          `}
          title="src/routes/handler/$.tsx"
          icon="code"
        />
        <Typography>
          If you start your TanStack Start app and navigate to <StyledLink href="http://localhost:3000/handler/sign-up">http://localhost:3000/handler/sign-up</StyledLink>, you will see the sign-up page.
        </Typography>
      </>
    },
  ];

  const javascriptSteps = [
    {
      step: 2,
      title: "Install Hexclave",
      content: <>
        <Typography>
          Install Hexclave using npm:
        </Typography>
        <CodeBlock
          language="bash"
          content={`npm install @hexclave/js`}
          customRender={
            <div className="p-4 font-mono text-sm">
              <span className={commandClasses}>npm install</span> <span className={nameClasses}>@hexclave/js</span>
            </div>
          }
          title="Terminal"
          icon="terminal"
        />
      </>
    },
    {
      step: 3,
      title: "Create Keys",
      content: <HexclaveKeys keys={keys} onGenerateKeys={onGenerateKeys} type="raw" />
    },
    {
      step: 4,
      title: "Initialize the app",
      content: <>
        <Typography>
          Create a new file for your Stack app initialization:
        </Typography>
        <Tabs defaultValue="server">
          <TabsList>
            <TabsTrigger value="server">Server</TabsTrigger>
            <TabsTrigger value="client">Client</TabsTrigger>
          </TabsList>
          <TabsContent value="server">
            <CodeBlock
              language="typescript"
              content={deindent`
                import { HexclaveServerApp } from "@hexclave/js";

                const hexclaveServerApp = new HexclaveServerApp({
                  // You should store these in environment variables based on your project setup
                  projectId: "${keys?.projectId ?? "..."}",${optionalPublishableClientKeyProp("  ")}
                  secretServerKey: "${keys?.secretServerKey ?? "..."}",
                  tokenStore: "memory",
                });
              `}
              title="stack/server.ts"
              icon="code"
            />
          </TabsContent>
          <TabsContent value="client">
            <CodeBlock
              language="typescript"
              content={deindent`
                import { HexclaveClientApp } from "@hexclave/js";

                const hexclaveClientApp = new HexclaveClientApp({
                  // You should store these in environment variables
                  projectId: "your-project-id",${optionalPublishableClientKeyProp("  ")}
                  tokenStore: "cookie",
                });
              `}
              title="stack/client.ts"
              icon="code"
            />
          </TabsContent>
        </Tabs>
      </>
    },
    {
      step: 5,
      title: "Example usage",
      content: <>
        <Tabs defaultValue="server">
          <TabsList>
            <TabsTrigger value="server">Server</TabsTrigger>
            <TabsTrigger value="client">Client</TabsTrigger>
          </TabsList>
          <TabsContent value="server">
            <CodeBlock
              language="typescript"
              content={deindent`
                import { hexclaveServerApp } from "@/stack/server";

                const user = await hexclaveServerApp.getUser("user_id");

                await user.update({
                  displayName: "New Display Name",
                });

                const team = await hexclaveServerApp.createTeam({
                  name: "New Team",
                });

                await team.addUser(user.id);
              `}
              title="Example server usage"
              icon="code"
            />
          </TabsContent>
          <TabsContent value="client">
            <CodeBlock
              language="typescript"
              content={deindent`
                import { hexclaveClientApp } from "@/stack/client";

                await hexclaveClientApp.signInWithCredential({
                  email: "test@example.com",
                  password: "password123",
                });

                const user = await hexclaveClientApp.getUser();

                await user.update({
                  displayName: "New Display Name",
                });

                await user.signOut();
              `}
              title="Example client usage"
              icon="code"
            />
          </TabsContent>
        </Tabs>
      </>
    }
  ];

  const pythonSteps = [
    {
      step: 2,
      title: "Install requests",
      content: <>
        <Typography>
          Install the requests library to make HTTP requests to the Hexclave API:
        </Typography>
        <CodeBlock
          language="bash"
          content={`pip install requests`}
          customRender={
            <div className="p-4 font-mono text-sm">
              <span className={commandClasses}>pip install</span> <span className={nameClasses}>requests</span>
            </div>
          }
          title="Terminal"
          icon="terminal"
        />
      </>
    },
    {
      step: 3,
      title: "Create Keys",
      content: <HexclaveKeys keys={keys} onGenerateKeys={onGenerateKeys} type="raw" />
    },
    {
      step: 4,
      title: "Create helper function",
      content: <>
        <Typography>
          Create a helper function to make requests to the Hexclave API:
        </Typography>
        <CodeBlock
          language="python"
          content={deindent`
            import requests

            def stack_auth_request(method, endpoint, **kwargs):
              res = requests.request(
                method,
                f'https://api.hexclave.com/{endpoint}',
                headers={
                  'x-hexclave-access-type': 'server',
                  # You should store these in environment variables
                  'x-hexclave-project-id': "${keys?.projectId ?? "..."}",${optionalPublishableClientKeyHeader("  ")}
                  'x-hexclave-secret-server-key': "${keys?.secretServerKey ?? "..."}",
                  **kwargs.pop('headers', {}),
                },
                **kwargs,
              )
              if res.status_code >= 400:
                raise Exception(f"Hexclave API request failed with {res.status_code}: {res.text}")
              return res.json()
          `}
          title="stack_auth.py"
          icon="code"
        />
      </>
    },
    {
      step: 5,
      title: "Make requests",
      content: <>
        <Typography>
          You can now make requests to the Hexclave API:
        </Typography>
        <CodeBlock
          language="python"
          content={deindent`
            # Get current project info
            print(stack_auth_request('GET', '/api/v1/projects/current'))

            # Get user info with access token
            print(stack_auth_request('GET', '/api/v1/users/me', headers={
              'x-hexclave-access-token': access_token,
            }))
          `}
          title="example.py"
          icon="code"
        />
      </>
    }
  ];


  return (
    <PageLayout width={1000}>
      <div className="flex justify-end">
        <DesignButton variant='plain' onClick={props.toMetrics}>
          Close Setup
          <XIcon className="w-4 h-4 ml-1 mt-0.5" />
        </DesignButton>
      </div>
      <div className="flex gap-4 justify-center items-center border rounded-2xl py-4 px-8 backdrop-blur-md bg-slate-200/20 dark:bg-black/20">
        <GlobeIllustration />

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <div className='text-[rgb(107,93,247)] flex items-center gap-1.5 text-xs font-bold'>
              <div className={styles.livePulse} />
              Waiting for your first user...
            </div>
            <Typography type="h2">
              Setup Hexclave in your codebase
            </Typography>
          </div>

          <Typography>
            <DesignButton
              variant='outline'
              size='sm'
              onClick={() => {
                window.open('https://docs.hexclave.com/', '_blank');
              }}
            >
              <BookIcon className="w-4 h-4 mr-2" />
              Full Documentation
            </DesignButton>
          </Typography>
        </div>
      </div>

      <div className="flex justify-end mt-8 mx-4">
        <CopyPromptButton
          variant="outline"
          size="sm"
          content={buildInstallPrompt(selectedFramework)}
        >
          <SparkleIcon className="w-4 h-4 mr-2 text-purple-500 dark:text-purple-400" weight="fill" />
          Copy prompt
        </CopyPromptButton>
      </div>

      <div className="flex flex-col mt-4 mx-4">
        <ol className="relative text-gray-500 border-s border-gray-200 dark:border-gray-700 dark:text-gray-400 ">
          {[
            {
              step: 1,
              title: "Select your framework",
              content: <div>
                <div className="flex gap-4 flex-wrap">
                  {([{
                    id: 'nextjs',
                    name: 'Next.js',
                    reverseIfDark: true,
                    imgSrc: '/next-logo.svg',
                  }, {
                    id: 'tanstackStart',
                    name: 'TanStack Start',
                    reverseIfDark: false,
                    imgSrc: '/tanstack-start-logo.png',
                  }, {
                    id: 'react',
                    name: 'React',
                    reverseIfDark: false,
                    imgSrc: '/react-logo.svg',
                  }, {
                    id: 'javascript',
                    name: 'JavaScript',
                    reverseIfDark: false,
                    imgSrc: '/javascript-logo.svg',
                  }, {
                    id: 'python',
                    name: 'Python',
                    reverseIfDark: false,
                    imgSrc: '/python-logo.svg',
                  }] as const).map(({ name, imgSrc: src, reverseIfDark, id }) => (
                    <DesignButton
                      key={id}
                      variant={id === selectedFramework ? 'secondary' : 'plain'} className='h-24 w-24 flex flex-col items-center justify-center gap-2 '
                      onClick={() => setSelectedFramework(id)}
                    >
                      <Image
                        src={src}
                        alt={name}

                        className={reverseIfDark ? "dark:invert" : undefined}
                        width="0"
                        height="0"
                        sizes="100vw"
                        style={{ width: '30px', height: 'auto' }}
                      />
                      <Typography type='label'>{name}</Typography>
                    </DesignButton>
                  ))}
                </div>
              </div>,
            },
            ...(selectedFramework === 'nextjs' ? nextJsSteps : []),
            ...(selectedFramework === 'tanstackStart' ? tanstackStartSteps : []),
            ...(selectedFramework === 'react' ? reactSteps : []),
            ...(selectedFramework === 'javascript' ? javascriptSteps : []),
            ...(selectedFramework === 'python' ? pythonSteps : []),
          ].map((item, index) => (
            <li key={item.step} className={cn("ms-6 flex flex-col lg:flex-row gap-10 mb-20")}>
              <div className="flex flex-col justify-center gap-2 max-w-[180px] min-w-[180px]">
                <span className={`absolute flex items-center justify-center w-8 h-8 bg-gray-100 dark:bg-gray-70 rounded-full -start-4 ring-4 ring-white dark:ring-gray-900`}>
                  <span className={`text-gray-500 dark:text-gray-700 font-medium`}>{item.step}</span>
                </span>
                <h3 className="font-medium leading-tight">{item.title}</h3>
              </div>
              <div className="flex flex-grow flex-col gap-4">
                {item.content}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </PageLayout>
  );
}

function GlobeIllustration() {
  return (
    <div className="w-[200px] h-[200px] relative hidden md:block">
      <Suspense fallback={"LOADING"}>
        <GlobeIllustrationInner />
      </Suspense>
    </div>
  );
}

function GlobeIllustrationInner() {
  const { theme, mounted } = useThemeWatcher();
  const [showPulse, setShowPulse] = useState(false);
  const globeEl = useRef<GlobeMethods | undefined>(undefined);
  const countries = use(countriesPromise);

  return (
    <>
      {showPulse && (
        <div className="absolute inset-0 pointer-events-none w-[200px] h-[200px] flex items-center justify-center">
          {[...Array(3)].map((_, i) => (
            <div
              key={i}
              className={`${styles['pulse-circle']} rounded-full bg-blue-200 dark:bg-blue-800`}
              style={{
                width: "50px",
                height: "50px",
                animationDelay: `${i * 2.5}s`,
              }}
            />
          ))}
        </div>
      )}

      <div className="relative z-10 items-center justify-center w-full h-full hidden md:flex">
        {mounted && (
          <Globe
            ref={globeEl}
            onGlobeReady={() => {
              const setupControls = () => {
                if (globeEl.current) {
                  const controls = globeEl.current.controls();
                  controls.autoRotate = true;
                  controls.enableZoom = false;
                  controls.enablePan = false;
                  controls.enableRotate = false;
                  return true;
                }
                return false;
              };

              setupControls();
              // Sometimes the controls don't get set up in time, so we try again
              setTimeout(setupControls, 100);
              setTimeout(() => setShowPulse(true), 200);
            }}
            globeImageUrl={globeImages[theme]}
            backgroundColor="#00000000"
            polygonsData={countries.features}
            polygonCapColor={() => "transparent"}
            polygonSideColor={() => "transparent"}
            hexPolygonsData={countries.features}
            hexPolygonResolution={1}
            hexPolygonMargin={0.2}
            hexPolygonAltitude={0.003}
            hexPolygonColor={() => "rgb(107, 93, 247)"}
            width={160}
            height={160}
          />
        )}
      </div>
    </>
  );
}

function HexclaveKeys(props: {
  keys: { projectId: string, publishableClientKey?: string, secretServerKey: string } | null,
  onGenerateKeys: () => Promise<void>,
  type: 'next' | 'vite' | 'raw',
}) {
  return (
    <div className="w-full border rounded-xl p-8 gap-4 flex flex-col">
      {props.keys ? (
        <>
          {props.type === 'next' ? (
            <NextJsEnvKeys
              projectId={props.keys.projectId}
              publishableClientKey={props.keys.publishableClientKey}
              secretServerKey={props.keys.secretServerKey}
            />
          ) : props.type === 'vite' ? (
            <ViteEnvKeys
              projectId={props.keys.projectId}
              secretServerKey={props.keys.secretServerKey}
            />
          ) : (
            <APIEnvKeys
              projectId={props.keys.projectId}
              publishableClientKey={props.keys.publishableClientKey}
              secretServerKey={props.keys.secretServerKey}
            />
          )}

          <Typography type="label" variant="secondary">
            {`Save these keys securely - they won't be shown again after leaving this page.`}
          </Typography>
        </>
      ) : (
        <div className="flex items-center justify-center">
          <DesignButton onClick={props.onGenerateKeys}>
            Generate Keys
          </DesignButton>
        </div>
      )}
    </div>
  );
}
