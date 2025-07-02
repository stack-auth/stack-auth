'use client';

import { CodeBlock } from '@/components/code-block';
import { APIEnvKeys, NextJsEnvKeys } from '@/components/env-keys';
import { InlineCode } from '@/components/inline-code';
import { StyledLink } from '@/components/link';
import { useThemeWatcher } from '@/lib/theme';
import { deindent } from '@stackframe/stack-shared/dist/utils/strings';
import { Button, Tabs, TabsContent, TabsList, TabsTrigger, Typography, cn } from "@stackframe/stack-ui";
import { Book, X } from "lucide-react";
import dynamic from "next/dynamic";
import Image from 'next/image';
import { use, useEffect, useRef, useState } from "react";
import { GlobeMethods } from "react-globe.gl";
import { globeImages } from '../(utils)/utils';
import { PageLayout } from "../../page-layout";
import { useAdminApp } from '../../use-admin-app';
import styles from './setup-page.module.css';
const countriesPromise = import('../(utils)/country-data.geo.json');
const Globe = dynamic(() => import('react-globe.gl').then((mod) => mod.default), { ssr: false });

const commandClasses = "text-red-600 dark:text-red-400";
const nameClasses = "text-green-600 dark:text-green-500";

export default function SetupPage(props: { toMetrics: () => void }) {
  const adminApp = useAdminApp();
  const countries = use(countriesPromise);
  const globeEl = useRef<GlobeMethods | undefined>(undefined);
  const { theme, mounted } = useThemeWatcher();
  const [showPulse, setShowPulse] = useState(false);
  const [selectedFramework, setSelectedFramework] = useState<'nextjs' | 'react' | 'javascript' | 'python'>('nextjs');
  const [keys, setKeys] = useState<{ projectId: string, publishableClientKey: string, secretServerKey: string } | null>(null);

  const onGenerateKeys = async () => {
    const newKey = await adminApp.createInternalApiKey({
      hasPublishableClientKey: true,
      hasSecretServerKey: true,
      hasSuperSecretAdminKey: false,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
      description: 'Onboarding',
    });

    setKeys({
      projectId: adminApp.projectId,
      publishableClientKey: newKey.publishableClientKey!,
      secretServerKey: newKey.secretServerKey!,
    });
  };

  useEffect(() => {
    // Add delay before showing pulse circles in order to allow the globe to animate in
    const timer = setTimeout(() => {
      setShowPulse(true);
    }, 1000);

    return () => clearTimeout(timer);
  }, []);

  const nextJsSteps = [
    {
      step: 2,
      title: "Install Stack Auth",
      content: <>
        <Typography>
          In a new or existing Next.js project, run:
        </Typography>
        <CodeBlock
          language="bash"
          content={`npx @stackframe/init-stack@latest`}
          customRender={
            <div className="p-4 font-mono text-sm">
              <span className={commandClasses}>npx</span> <span className={nameClasses}>@stackframe/init-stack@latest</span>
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
        <StackAuthKeys keys={keys} onGenerateKeys={onGenerateKeys} type="next" />
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
      title: "Install Stack Auth",
      content: <>
        <Typography>
          In a new or existing React project, run:
        </Typography>
        <CodeBlock
          language="bash"
          content={`npm install @stackframe/react`}
          customRender={
            <div className="p-4 font-mono text-sm">
              <span className={commandClasses}>npm install</span> <span className={nameClasses}>@stackframe/react</span>
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
      content: <StackAuthKeys keys={keys} onGenerateKeys={onGenerateKeys} type="raw" />
    },
    {
      step: 4,
      title: "Create stack.ts file",
      content: <>
        <Typography>
          Create a new file called <InlineCode>stack.ts</InlineCode> and add the following code. Here we use react-router-dom as an example.
        </Typography>
        <CodeBlock
          language="tsx"
          content={deindent`
            import { StackClientApp } from "@stackframe/react";
            import { useNavigate } from "react-router-dom";
            
            export const stackClientApp = new StackClientApp({
              // You should store these in environment variables
              projectId: "${keys?.projectId ?? "..."}",
              publishableClientKey: "${keys?.publishableClientKey ?? "..."}",
              tokenStore: "cookie",
              redirectMethod: {
                useNavigate,
              }
            });
          `}
          title="stack.ts"
          icon="code"
        />
      </>
    },
    {
      step: 5,
      title: "Update App.tsx",
      content: <>
        <Typography>
          Update your App.tsx file to wrap the entire app with a <InlineCode>StackProvider</InlineCode> and <InlineCode>StackTheme</InlineCode> and add a <InlineCode>StackHandler</InlineCode> component to handle the authentication flow.
        </Typography>
        <CodeBlock
          language="tsx"
          maxHeight={300}
          content={deindent`
            import { StackHandler, StackProvider, StackTheme } from "@stackframe/react";
            import { Suspense } from "react";
            import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
            import { stackClientApp } from "./stack";

            function HandlerRoutes() {
              const location = useLocation();
              
              return (
                <StackHandler app={stackClientApp} location={location.pathname} fullPage />
              );
            }

            export default function App() {
              return (
                <Suspense fallback={null}>
                  <BrowserRouter>
                    <StackProvider app={stackClientApp}>
                      <StackTheme>
                        <Routes>
                          <Route path="/handler/*" element={<HandlerRoutes />} />
                          <Route path="/" element={<div>hello world</div>} />
                        </Routes>
                      </StackTheme>
                    </StackProvider>
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

  const javascriptSteps = [
    {
      step: 2,
      title: "Install Stack Auth",
      content: <>
        <Typography>
          Install Stack Auth using npm:
        </Typography>
        <CodeBlock
          language="bash"
          content={`npm install @stackframe/js`}
          customRender={
            <div className="p-4 font-mono text-sm">
              <span className={commandClasses}>npm install</span> <span className={nameClasses}>@stackframe/js</span>
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
      content: <StackAuthKeys keys={keys} onGenerateKeys={onGenerateKeys} type="raw" />
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
                import { StackServerApp } from "@stackframe/js";

                const stackServerApp = new StackServerApp({
                  // You should store these in environment variables based on your project setup
                  projectId: "${keys?.projectId ?? "..."}",
                  publishableClientKey: "${keys?.publishableClientKey ?? "..."}",
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
                import { StackClientApp } from "@stackframe/js";

                const stackClientApp = new StackClientApp({
                  // You should store these in environment variables
                  projectId: "your-project-id",
                  publishableClientKey: "your-publishable-client-key",
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
                import { stackServerApp } from "@/stack/server";

                const user = await stackServerApp.getUser("user_id");

                await user.update({
                  displayName: "New Display Name",
                });

                const team = await stackServerApp.createTeam({
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
                import { stackClientApp } from "@/stack/client";

                await stackClientApp.signInWithCredential({
                  email: "test@example.com",
                  password: "password123",
                });

                const user = await stackClientApp.getUser();

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
          Install the requests library to make HTTP requests to the Stack Auth API:
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
      content: <StackAuthKeys keys={keys} onGenerateKeys={onGenerateKeys} type="raw" />
    },
    {
      step: 4,
      title: "Create helper function",
      content: <>
        <Typography>
          Create a helper function to make requests to the Stack Auth API:
        </Typography>
        <CodeBlock
          language="python"
          content={deindent`
            import requests

            def stack_auth_request(method, endpoint, **kwargs):
              res = requests.request(
                method,
                f'https://api.stack-auth.com/{endpoint}',
                headers={
                  'x-stack-access-type': 'server',
                  # You should store these in environment variables
                  'x-stack-project-id': "${keys?.projectId ?? "..."}",
                  'x-stack-publishable-client-key': "${keys?.publishableClientKey ?? "..."}",
                  'x-stack-secret-server-key': "${keys?.secretServerKey ?? "..."}",
                  **kwargs.pop('headers', {}),
                },
                **kwargs,
              )
              if res.status_code >= 400:
                raise Exception(f"Stack Auth API request failed with {res.status_code}: {res.text}")
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
          You can now make requests to the Stack Auth API:
        </Typography>
        <CodeBlock
          language="python"
          content={deindent`
            # Get current project info
            print(stack_auth_request('GET', '/api/v1/projects/current'))

            # Get user info with access token
            print(stack_auth_request('GET', '/api/v1/users/me', headers={
              'x-stack-access-token': access_token,
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
        <Button variant='plain' onClick={props.toMetrics}>
          Close Setup
          <X className="w-4 h-4 ml-1 mt-0.5" />
        </Button>
      </div>
      <div className="flex gap-4 justify-center items-center border rounded-2xl py-4 px-8 backdrop-blur-md bg-white/20 dark:bg-black/20">
        <div className="w-[200px] h-[200px] relative hidden md:block">
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
        </div>

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
            <Button
              variant='outline'
              size='sm'
              onClick={() => {
                window.open('https://docs.stack-auth.com/', '_blank');
              }}
            >
              <Book className="w-4 h-4 mr-2" />
              Full Documentation
            </Button>
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
                <div className="flex gap-4 flex-wrap">
                  {([{
                    id: 'nextjs',
                    name: 'Next.js',
                    reverseIfDark: true,
                    imgSrc: '/next-logo.svg',
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
                    <Button
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
                    </Button>
                  ))}
                </div>
              </div>,
            },
            ...(selectedFramework === 'nextjs' ? nextJsSteps : []),
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

function StackAuthKeys(props: {
  keys: { projectId: string, publishableClientKey: string, secretServerKey: string } | null,
  onGenerateKeys: () => Promise<void>,
  type: 'next' | 'raw',
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
          <Button onClick={props.onGenerateKeys}>
            Generate Keys
          </Button>
        </div>
      )}
    </div>
  );
}
