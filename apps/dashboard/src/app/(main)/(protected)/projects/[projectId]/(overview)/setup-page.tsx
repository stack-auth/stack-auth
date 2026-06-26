'use client';

import { CodeBlock, codePanelShellClasses } from '@/components/code-block';
import { DesignButton } from "@/components/design-components";
import { EnvFileViewer } from '@/components/env-keys';
import { InlineCode } from '@/components/inline-code';
import { Tabs, TabsList, TabsTrigger, Typography, cn } from "@/components/ui";
import { getPublicEnvVar } from '@/lib/env';
import { useThemeWatcher } from '@/lib/theme';
import { BookIcon, XIcon } from "@phosphor-icons/react";
import { remindersPrompt } from '@hexclave/shared/dist/ai/unified-prompts/reminders';
import { use } from "@hexclave/shared/dist/utils/react";
import { deindent } from '@hexclave/shared/dist/utils/strings';
import dynamic from "next/dynamic";
import { Suspense, useRef, useState } from "react";
import type { GlobeMethods } from 'react-globe.gl';
import { PageLayout } from "../page-layout";
import { useAdminApp } from '../use-admin-app';
import { globeImages } from './globe';
import styles from './setup-page.module.css';

const countriesPromise = import('./country-data.geo.json');
const Globe = dynamic(() => import('react-globe.gl').then((mod) => mod.default), { ssr: false });

type SetupMode = "recommended" | "manual";

const PROD_DOCS_BASE_URL = 'https://docs.hexclave.com';
const PROD_API_BASE_URL = 'https://api.hexclave.com';

function getSetupDocsBaseUrl() {
  return getPublicEnvVar('NEXT_PUBLIC_STACK_DOCS_BASE_URL') ?? PROD_DOCS_BASE_URL;
}

function getManualSetupDocsUrl() {
  const docsBaseUrl = getSetupDocsBaseUrl().replace(/\/$/, '');
  return `${docsBaseUrl}/guides/getting-started/setup`;
}

function getSetupApiBaseUrl() {
  return getPublicEnvVar('NEXT_PUBLIC_STACK_API_URL') ?? PROD_API_BASE_URL;
}

function buildCloudSetupPrompt(options: {
  docsBaseUrl: string,
  projectId: string,
  apiBaseUrl: string,
}) {
  const { docsBaseUrl, projectId, apiBaseUrl } = options;
  const normalizedDocsBaseUrl = docsBaseUrl.replace(/\/$/, '');
  const reminders = remindersPrompt.replaceAll(PROD_DOCS_BASE_URL, normalizedDocsBaseUrl);

  return deindent`
    Install and set up Hexclave in this project by following these instructions:

    Read https://skill.hexclave.com and follow the setup instructions it gives for this project's specific framework and language.

    Follow skill.hexclave.com as written, but make sure to use the cloud setup, not the local dashboard setup.

    Do not change the dev script in package.json. In cloud setup, there's no need for that.

    Use these Hexclave project values when creating environment variables:

    - Hexclave API URL: ${apiBaseUrl}
    - Hexclave project ID: ${projectId}

    Create the framework-specific public environment variables for the Hexclave API URL and project ID. For example, Next.js uses NEXT_PUBLIC_HEXCLAVE_API_URL and NEXT_PUBLIC_HEXCLAVE_PROJECT_ID, while Vite-based frameworks use VITE_HEXCLAVE_API_URL and VITE_HEXCLAVE_PROJECT_ID. If the Hexclave docs for this framework specify different environment variable names, use the docs' framework-specific names with the values above.

    After setup finishes, verify that the Hexclave MCP server is registered in your AI client config — name: \`hexclave\`, transport: \`http\`, URL: \`https://mcp.hexclave.com/mcp\`. If it is not registered, add it manually so future agents have live access to Hexclave docs and APIs.

    Once setup is done, tell me to add the Hexclave secret server key from the dashboard to my environment file. After that, setup is complete.

    ${reminders}
  `;
}

export default function SetupPage(props: { toMetrics: () => void }) {
  const adminApp = useAdminApp();
  const [setupMode, setSetupMode] = useState<SetupMode>("recommended");
  const [keys, setKeys] = useState<{ projectId: string, publishableClientKey?: string, secretServerKey: string } | null>(null);
  const projectConfig = adminApp.useProject().useConfig();
  const requirePublishableClientKey = projectConfig.project.requirePublishableClientKey;

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

  const selectedInstallPrompt = buildCloudSetupPrompt({
    docsBaseUrl: getSetupDocsBaseUrl(),
    projectId: adminApp.projectId,
    apiBaseUrl: getSetupApiBaseUrl(),
  });
  const manualSetupDocsUrl = getManualSetupDocsUrl();

  return (
    <PageLayout width={1000}>
      <div className="flex justify-end">
        <DesignButton variant='plain' onClick={props.toMetrics}>
          Close Setup
          <XIcon className="w-4 h-4 ml-1 mt-0.5" />
        </DesignButton>
      </div>
      <div className="flex gap-4 justify-center items-center rounded-2xl py-4 px-8 backdrop-blur-md bg-white/60 dark:bg-background/40 ring-1 ring-black/[0.06] dark:ring-white/[0.06] border border-black/[0.06] dark:border-white/[0.06] shadow-sm">
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
                window.open(getSetupDocsBaseUrl(), '_blank');
              }}
            >
              <BookIcon className="w-4 h-4 mr-2" />
              Full Documentation
            </DesignButton>
          </Typography>
        </div>
      </div>

      <div className="flex justify-end mt-8 mx-4">
        <Tabs value={setupMode} onValueChange={(value) => setSetupMode(value === "manual" ? "manual" : "recommended")}>
          <TabsList>
            <TabsTrigger value="recommended">Recommended</TabsTrigger>
            <TabsTrigger value="manual">Manual setup</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {setupMode === "recommended" ? (
        <div className="flex flex-col mt-4 mx-4">
          <ol className="relative text-gray-500 border-s border-gray-200 dark:border-gray-700 dark:text-gray-400 ">
            {[
              {
                step: 1,
                title: "Copy Setup Prompt",
                content: <div className="flex min-w-0 flex-col gap-4">
                  <CodeBlock
                    language="text"
                    content={selectedInstallPrompt}
                    customRender={
                      <pre className="max-h-[480px] overflow-y-auto whitespace-pre-wrap break-words p-4 text-sm leading-6 text-foreground">
                        {selectedInstallPrompt}
                      </pre>
                    }
                    title="Prompt for your AI agent"
                    icon="code"
                    maxHeight={480}
                  />
                </div>,
              },
              {
                step: 2,
                title: "Create Keys",
                content: <>
                  <Typography>
                    Add this server-only key to your project&apos;s <InlineCode>.env.local</InlineCode> file.
                  </Typography>
                  <HexclaveKeys keys={keys} onGenerateKeys={onGenerateKeys} />
                </>,
              },
              {
                step: 3,
                title: "Done",
                content: <SetupRecommendedDoneStep onExploreDashboard={props.toMetrics} />,
              },
            ].map((item) => (
              <li key={item.step} className={cn("ms-6 flex flex-col lg:flex-row gap-10 mb-20")}>
                <div className="flex flex-col justify-center gap-2 max-w-[180px] min-w-[180px]">
                  <span className={`absolute flex items-center justify-center w-8 h-8 bg-zinc-100 dark:bg-zinc-800 rounded-full -start-4 ring-4 ring-white dark:ring-zinc-900`}>
                    <span className={`text-zinc-500 dark:text-zinc-400 font-semibold`}>{item.step}</span>
                  </span>
                  <h3 className="font-medium leading-tight">{item.title}</h3>
                </div>
                <div className="flex min-w-0 flex-grow flex-col gap-4">
                  {item.content}
                </div>
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <div className="mx-4 mt-12 flex flex-col items-center gap-4 py-16 text-center">
          <Typography>
            Manual setup steps live in the documentation so they stay up to date with every framework and SDK change.
          </Typography>
          <DesignButton
            onClick={() => {
              window.open(manualSetupDocsUrl, '_blank');
            }}
          >
            <BookIcon className="w-4 h-4 mr-2" />
            Open manual setup docs
          </DesignButton>
        </div>
      )}
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

function SetupRecommendedDoneStep(props: { onExploreDashboard: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <Typography>
        Hooray! Setup completed.
      </Typography>
      <div>
        <DesignButton onClick={props.onExploreDashboard}>
          Explore Dashboard
        </DesignButton>
      </div>
    </div>
  );
}

function HexclaveKeys(props: {
  keys: { projectId: string, publishableClientKey?: string, secretServerKey: string } | null,
  onGenerateKeys: () => Promise<void>,
}) {
  if (!props.keys) {
    return (
      <div className={cn(codePanelShellClasses, "w-full p-5 flex flex-col")}>
        <div className="flex items-center justify-center">
          <DesignButton onClick={props.onGenerateKeys}>
            Generate Keys
          </DesignButton>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col gap-3">
      <EnvFileViewer filename=".env.local" value={`HEXCLAVE_SECRET_SERVER_KEY=${props.keys.secretServerKey}`} />

      <Typography type="label" variant="secondary">
        {`Save these keys securely - they won't be shown again after leaving this page.`}
      </Typography>
    </div>
  );
}
