'use client';

import { CodeBlock } from '@/components/code-block';
import { APIEnvKeys, FrameworkEnvKeys, type EnvSnippetPreset } from '@/components/env-keys';
import { InlineCode } from '@/components/inline-code';
import { StyledLink } from '@/components/link';
import { Tabs, TabsContent, TabsList, TabsTrigger, Typography, cn } from "@/components/ui";
import { DesignButton } from "@/components/design-components";
import { useThemeWatcher } from '@/lib/theme';
import { BookIcon, XIcon } from "@phosphor-icons/react";
import { use } from "@stackframe/stack-shared/dist/utils/react";
import { deindent } from '@stackframe/stack-shared/dist/utils/strings';
import dynamic from "next/dynamic";
import Image from 'next/image';
import { Suspense, useRef, useState } from "react";
import type { GlobeMethods } from 'react-globe.gl';
import { PageLayout } from "../page-layout";
import { getSetupFramework, setupFrameworkGroups, type SetupFrameworkId } from './setup-frameworks';
import { useAdminApp } from '../use-admin-app';
import { globeImages } from './globe';
import styles from './setup-page.module.css';

const countriesPromise = import('./country-data.geo.json');
const Globe = dynamic(() => import('react-globe.gl').then((mod) => mod.default), { ssr: false });

const commandClasses = "text-red-600 dark:text-red-400";
const nameClasses = "text-green-600 dark:text-green-500";

export default function SetupPage(props: { toMetrics: () => void }) {
  const adminApp = useAdminApp();
  const [selectedFramework, setSelectedFramework] = useState<SetupFrameworkId>('nextjs');
  const [keys, setKeys] = useState<{ projectId: string, publishableClientKey?: string, secretServerKey: string } | null>(null);
  const projectConfig = adminApp.useProject().useConfig();
  const requirePublishableClientKey = projectConfig.project.requirePublishableClientKey;
  const publishableClientKeyValue = keys?.publishableClientKey ?? "...";
  const framework = getSetupFramework(selectedFramework);
  const optionalPublishableClientKeyProp = (indent: string) =>
    requirePublishableClientKey ? `\n${indent}publishableClientKey: "${publishableClientKeyValue}",` : "";

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

  const stackClientSnippet = deindent`
    import { StackClientApp } from "${framework.packageName}";
    ${selectedFramework === "react-router" ? 'import { useNavigate } from "react-router-dom";' : ""}
    ${selectedFramework === "tanstack-start" ? 'import { useNavigate } from "@tanstack/react-router";' : ""}

    export const stackClientApp = new StackClientApp({
      ${framework.envPreset === "nextjs" ? "// Environment variables are automatically read" : `projectId: "${keys?.projectId ?? "..."}",${optionalPublishableClientKeyProp("  ")}`}
      tokenStore: "${framework.packageName === "@stackframe/stack" ? "nextjs-cookie" : "cookie"}",${selectedFramework === "react-router" || selectedFramework === "tanstack-start" ? `
      redirectMethod: {
        useNavigate,
      },` : ""}
    });
  `;

  const stackServerSnippet = deindent`
    import { StackServerApp } from "${framework.packageName}";

    export const stackServerApp = new StackServerApp({
      projectId: "${keys?.projectId ?? "..."}",${optionalPublishableClientKeyProp("  ")}
      secretServerKey: "${keys?.secretServerKey ?? "..."}",
      tokenStore: "memory",
    });
  `;

  const installCommand = selectedFramework === "nextjs"
    ? "npx @stackframe/stack-cli@latest init"
    : `npm install ${framework.packageName}`;

  const installStep = {
    step: 2,
    title: "Install Stack Auth",
    content: <>
      <Typography>
        {selectedFramework === "nextjs"
          ? "In a new or existing Next.js project, install Stack Auth using the initializer."
          : `Install ${framework.packageName} for ${framework.name}.`}
      </Typography>
      <CodeBlock
        language="bash"
        content={installCommand}
        customRender={
          <div className="p-4 font-mono text-sm">
            <span className={commandClasses}>{selectedFramework === "nextjs" ? "pnpx" : "npm install"}</span>{" "}
            <span className={nameClasses}>{selectedFramework === "nextjs" ? "@stackframe/stack-cli@latest init" : framework.packageName}</span>
          </div>
        }
        title="Terminal"
        icon="terminal"
      />
    </>,
  };

  const keysStep = {
    step: 3,
    title: "Create Keys",
    content: <>
      <Typography>
        {framework.envPreset
          ? "Copy these into the framework-specific env format or configuration file."
          : "Copy these raw keys into your runtime bindings, secrets manager, or server env configuration."}
      </Typography>
      <StackAuthKeys
        keys={keys}
        onGenerateKeys={onGenerateKeys}
        envPreset={framework.envPreset}
      />
    </>,
  };

  const configStep = {
    step: 4,
    title: "Create Stack app files",
    content: <>
      {(selectedFramework === "nextjs" || selectedFramework === "react-router" || selectedFramework === "tanstack-start" || selectedFramework === "nuxt" || selectedFramework === "sveltekit") ? (
        <Tabs defaultValue="client">
          <TabsList>
            <TabsTrigger value="client">Client</TabsTrigger>
            <TabsTrigger value="server">Server</TabsTrigger>
          </TabsList>
          <TabsContent value="client">
            <CodeBlock language="typescript" content={stackClientSnippet} title="stack/client.ts" icon="code" />
          </TabsContent>
          <TabsContent value="server">
            <CodeBlock language="typescript" content={selectedFramework === "nextjs" ? deindent`
              import "server-only";
              import { StackServerApp } from "@stackframe/stack";
              import { stackClientApp } from "./client";

              export const stackServerApp = new StackServerApp({
                inheritsFrom: stackClientApp,
              });
            ` : stackServerSnippet} title="stack/server.ts" icon="code" />
          </TabsContent>
        </Tabs>
      ) : (
        <CodeBlock language="typescript" content={selectedFramework === "cloudflare-workers" ? deindent`
          import { StackServerApp } from "@stackframe/js";

          export function createStackServerApp(env: Env) {
            return new StackServerApp({
              projectId: env.STACK_PROJECT_ID,${optionalPublishableClientKeyProp("      ")}
              secretServerKey: env.STACK_SECRET_SERVER_KEY,
              tokenStore: "memory",
            });
          }
        ` : stackServerSnippet} title="stack/server.ts" icon="code" />
      )}
    </>,
  };

  const integrationStep = {
    step: 5,
    title: framework.usesStackHandler ? "Integrate Stack into your app" : "Use Stack in your routes and handlers",
    content: <>
      <CodeBlock
        language="tsx"
        maxHeight={320}
        content={selectedFramework === "nextjs" ? deindent`
          'use client';
          import { useAnalytics, useUser } from "@stackframe/stack";

          export default function Dashboard() {
            const user = useUser();
            const { track } = useAnalytics();

            if (!user) return <div>Please sign in</div>;

            return (
              <button onClick={() => track("dashboard.viewed", { framework: "nextjs" })}>
                Hello, {user.displayName}!
              </button>
            );
          }
        ` : selectedFramework === "react-router" ? deindent`
          import { StackHandler, StackProvider, StackTheme, useAnalytics } from "@stackframe/react";
          import { Suspense } from "react";
          import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
          import { stackClientApp } from "./stack/client";

          function HandlerRoutes() {
            const location = useLocation();
            return <StackHandler app={stackClientApp} location={location.pathname} fullPage />;
          }

          function Dashboard() {
            const { track } = useAnalytics();
            return <button onClick={() => track("dashboard.viewed", { framework: "react-router" })}>Track event</button>;
          }

          export default function App() {
            return (
              <Suspense fallback={"Loading..."}>
                <BrowserRouter>
                  <StackProvider app={stackClientApp}>
                    <StackTheme>
                      <Routes>
                        <Route path="/handler/*" element={<HandlerRoutes />} />
                        <Route path="/" element={<Dashboard />} />
                      </Routes>
                    </StackTheme>
                  </StackProvider>
                </BrowserRouter>
              </Suspense>
            );
          }
        ` : selectedFramework === "tanstack-start" ? deindent`
          import { StackHandler, StackProvider, StackTheme, useAnalytics } from "@stackframe/react";
          import { createFileRoute, useRouterState } from "@tanstack/react-router";
          import { stackClientApp } from "../stack/client";

          export const Route = createFileRoute("/handler/$")({
            component: HandlerRoute,
          });

          function HandlerRoute() {
            const pathname = useRouterState({ select: (state) => state.location.pathname });
            return <StackHandler app={stackClientApp} location={pathname} fullPage />;
          }

          export function Dashboard() {
            const { track } = useAnalytics();
            return <button onClick={() => track("dashboard.viewed", { framework: "tanstack-start" })}>Track event</button>;
          }
        ` : selectedFramework === "nuxt" ? deindent`
          import { tokenStoreFromHeaders } from "@stackframe/js";
          import { stackServerApp } from "~/stack/server";

          export default defineEventHandler(async (event) => {
            const tokenStore = tokenStoreFromHeaders(event.node.req.headers);
            const user = await stackServerApp.getUser({ tokenStore });
            await stackServerApp.track("dashboard.viewed", { framework: "nuxt" }, { tokenStore });
            return { userId: user?.id ?? null };
          });
        ` : selectedFramework === "sveltekit" ? deindent`
          import { stackServerApp } from "$lib/stack/server";

          export async function load({ request }) {
            const user = await stackServerApp.getUser({ tokenStore: request });
            await stackServerApp.track("dashboard.viewed", { framework: "sveltekit" }, { tokenStore: request });
            return { userId: user?.id ?? null };
          }
        ` : selectedFramework === "nestjs" ? deindent`
          import { Controller, Get, Req } from "@nestjs/common";
          import { tokenStoreFromHeaders } from "@stackframe/js";
          import { stackServerApp } from "./stack/server";

          @Controller("profile")
          export class ProfileController {
            @Get()
            async read(@Req() req: { headers: Record<string, string | string[] | undefined> }) {
              const tokenStore = tokenStoreFromHeaders(req.headers);
              const user = await stackServerApp.getUser({ tokenStore });
              await stackServerApp.track("dashboard.viewed", { framework: "nestjs" }, { tokenStore });
              return { userId: user?.id ?? null };
            }
          }
        ` : selectedFramework === "express" ? deindent`
          import express from "express";
          import { tokenStoreFromHeaders } from "@stackframe/js";
          import { stackServerApp } from "./stack/server";

          const app = express();
          app.get("/profile", async (req, res) => {
            const tokenStore = tokenStoreFromHeaders(req.headers);
            const user = await stackServerApp.getUser({ tokenStore });
            await stackServerApp.track("dashboard.viewed", { framework: "express" }, { tokenStore });
            res.json({ userId: user?.id ?? null });
          });
        ` : selectedFramework === "hono" ? deindent`
          import { Hono } from "hono";
          import { stackServerApp } from "./stack/server";

          const app = new Hono();
          app.get("/profile", async (c) => {
            const user = await stackServerApp.getUser({ tokenStore: c.req.raw });
            await stackServerApp.track("dashboard.viewed", { framework: "hono" }, { tokenStore: c.req.raw });
            return c.json({ userId: user?.id ?? null });
          });
        ` : deindent`
          import { createStackServerApp } from "./stack/server";

          export default {
            async fetch(request: Request, env: Env) {
              const stackServerApp = createStackServerApp(env);
              const user = await stackServerApp.getUser({ tokenStore: request });
              await stackServerApp.track("dashboard.viewed", { framework: "cloudflare-workers" }, { tokenStore: request });
              return Response.json({ userId: user?.id ?? null });
            },
          };
        `}
        title={framework.usesStackHandler ? "App integration" : "Route / handler usage"}
        icon="code"
      />
    </>,
  };

  const doneStep = {
    step: 6,
    title: "Done",
    content: (
      <Typography>
        {selectedFramework === "nextjs" ? (
          <>If you start your Next.js app and navigate to <StyledLink href="http://localhost:3000/handler/signup">http://localhost:3000/handler/signup</StyledLink>, you should see the sign-up page.</>
        ) : framework.usesStackHandler ? (
          <>Start your app and open the handler route you mounted. Then trigger a page render or button click that calls <InlineCode>useAnalytics()</InlineCode> to verify the client-side flow.</>
        ) : (
          <>Start your server/runtime and verify one request can call <InlineCode>stackServerApp.getUser()</InlineCode> and <InlineCode>stackServerApp.track()</InlineCode> using the selected framework pattern.</>
        )}
      </Typography>
    ),
  };


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
              Setup Stack Auth in your codebase
            </Typography>
          </div>

          <Typography>
            <DesignButton
              variant='outline'
              size='sm'
              onClick={() => {
                window.open('https://docs.stack-auth.com/', '_blank');
              }}
            >
              <BookIcon className="w-4 h-4 mr-2" />
              Full Documentation
            </DesignButton>
          </Typography>
        </div>
      </div>

      <div className="flex flex-col mt-10 mx-4">
        <ol className="relative text-gray-500 border-s border-gray-200 dark:border-gray-700 dark:text-gray-400 ">
          {[
            {
              step: 1,
              title: "Select your framework",
              content: <div>
                <div className="flex flex-col gap-8">
                  {setupFrameworkGroups.map((group) => (
                    <div key={group.id} className="flex flex-col gap-3">
                      <Typography type="label">{group.name}</Typography>
                      <div className="flex gap-4 flex-wrap">
                        {group.frameworkIds.map((frameworkId) => {
                          const groupFramework = getSetupFramework(frameworkId);
                          return (
                            <DesignButton
                              key={frameworkId}
                              variant={frameworkId === selectedFramework ? 'secondary' : 'plain'}
                              className='h-24 w-28 flex flex-col items-center justify-center gap-2'
                              onClick={() => setSelectedFramework(frameworkId)}
                            >
                              <Image
                                src={groupFramework.imgSrc}
                                alt={groupFramework.name}
                                className={groupFramework.reverseIfDark ? "dark:invert" : undefined}
                                width="0"
                                height="0"
                                sizes="100vw"
                                style={{ width: '30px', height: 'auto' }}
                              />
                              <Typography type='label'>{groupFramework.name}</Typography>
                            </DesignButton>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                  <Typography type="label" variant="secondary">
                    Need Nitro, Fastify, Elysia, Astro, Standalone, OpenTelemetry, or log streaming? The docs cover those as runtime-supported or integration-level recipes.
                  </Typography>
                </div>
              </div>,
            },
            installStep,
            keysStep,
            configStep,
            integrationStep,
            doneStep,
          ].map((item) => (
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

function StackAuthKeys(props: {
  keys: { projectId: string, publishableClientKey?: string, secretServerKey: string } | null,
  onGenerateKeys: () => Promise<void>,
  envPreset: EnvSnippetPreset | null,
}) {
  return (
    <div className="w-full border rounded-xl p-8 gap-4 flex flex-col">
      {props.keys ? (
        <>
          {props.envPreset ? (
            <FrameworkEnvKeys
              projectId={props.keys.projectId}
              publishableClientKey={props.keys.publishableClientKey}
              secretServerKey={props.keys.secretServerKey}
              defaultPreset={props.envPreset}
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
