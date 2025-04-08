'use client';

import { StyledLink } from '@/components/link';
import { getPublicEnvVar } from '@/lib/env';
import { useThemeWatcher } from '@/lib/theme';
import { Button, CopyButton, Typography, cn } from "@stackframe/stack-ui";
import { Book, Terminal } from "lucide-react";
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

export default function SetupPage() {
  const adminApp = useAdminApp();
  const countries = use(countriesPromise);
  const globeEl = useRef<GlobeMethods | undefined>(undefined);
  const { theme, mounted } = useThemeWatcher();
  const [showPulse, setShowPulse] = useState(false);
  const [setupCode, setSetupCode] = useState<string | undefined>(undefined);
  const apiUrl = getPublicEnvVar('NEXT_PUBLIC_STACK_API_URL') === "https://api.stack-auth.com" ? undefined : getPublicEnvVar('NEXT_PUBLIC_STACK_API_URL');

  useEffect(() => {
    const fetchSetupCode = async () => {
      const code = await adminApp.createSetupCode();
      setSetupCode(code.code);
    };
    fetchSetupCode().catch(console.error);

    // Refresh the setup code every 10 minutes
    const refreshInterval = 10 * 60 * 1000; // 10 minutes in milliseconds
    const intervalId = setInterval(() => {
      fetchSetupCode().catch(console.error);
    }, refreshInterval);

    // Clean up interval on component unmount
    return () => clearInterval(intervalId);
  }, [adminApp]);

  useEffect(() => {
    // Add delay before showing pulse circles in order to allow the globe to animate in
    const timer = setTimeout(() => {
      setShowPulse(true);
    }, 1000);

    return () => clearTimeout(timer);
  }, []);

  return (
    <PageLayout width={1000}>
      <div className="flex gap-4 justify-center items-center border rounded-2xl py-4 px-8">
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
                width={180}
                height={180}
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
        <ol className="relative text-gray-500 border-s border-gray-200 dark:border-gray-700 dark:text-gray-400">
          {[
            {
              step: 1,
              title: "Select your framework",
              description: "Create a new project or use an existing one",
              content: <div>
                <div className="flex gap-4 flex-wrap">
                  {[{
                    name: 'Next.js',
                    reverseIfDark: true,
                    imgSrc: '/next-logo.svg',
                  }, {
                    name: 'React',
                    imgSrc: '/react-logo.svg',
                    onClick: () => {
                      window.open('https://docs.stack-auth.com/react/getting-started/setup', '_blank');
                    },
                  }, {
                    name: 'JavaScript',
                    imgSrc: '/javascript-logo.svg',
                    onClick: () => {
                      window.open('https://docs.stack-auth.com/js/getting-started/setup', '_blank');
                    },
                  }, {
                    name: 'Python',
                    imgSrc: '/python-logo.svg',
                    onClick: () => {
                      window.open('https://docs.stack-auth.com/python/getting-started/setup', '_blank');
                    },
                  }].map(({ name, imgSrc: src, reverseIfDark, onClick }) => (
                    <Button variant={name === 'Next.js' ? 'secondary' : 'plain'} className='h-24 w-24 flex flex-col items-center justify-center gap-2 ' key={name} onClick={onClick}>
                      <Image
                        src={src}
                        alt={name}
                        width={30}
                        height={30}
                        className={reverseIfDark ? "dark:invert" : undefined}
                      />
                      <Typography type='label'>{name}</Typography>
                    </Button>
                  ))}
                </div>
              </div>,
            },
            {
              step: 2,
              title: "Install Stack Auth",
              description: "The wizard will guide you through the setup process",
              content: <div className="flex flex-col w-0 flex-grow gap-4">
                In a new or existing Next.js project, run:
                <CodeSnippet
                  type="Terminal"
                  content={[
                    [
                      { value: "npx", className: "text-purple-600" },
                      {
                        value: "@stackframe/init@latest",
                        className: "",
                      },
                      ...(apiUrl ? [{
                        value: `--api-url=${apiUrl}`,
                        className: "text-green-600",
                      }] : []),
                      ...(setupCode ? [{
                        value: `--setup=${setupCode}`,
                        className: "text-green-600",
                      }] : []),
                    ],
                  ]}
                />
              </div>
            },
            {
              step: 3,
              title: "Done",
              description: "You're all set up!",
              content: <div className="">
                If you start your Next.js app with npm run dev and navigate to <StyledLink href="http://localhost:3000/handler/signup">http://localhost:3000/handler/signup</StyledLink>, you will see the sign-up page.
              </div>
            },
          ].map((item, index) => (
            <li key={item.step} className={cn("ms-6 flex flex-col lg:flex-row gap-10", { "mb-20": index < 3 })}>
              <div className="flex flex-col gap-2 max-w-[180px] min-w-[180px]">
                <span className={`absolute flex items-center justify-center w-8 h-8 bg-gray-100 dark:bg-gray-70 rounded-full -start-4 ring-4 ring-white dark:ring-gray-900`}>
                  <span className={`text-gray-500 dark:text-gray-700 font-medium`}>{item.step}</span>
                </span>
                <h3 className="font-medium leading-tight">{item.title}</h3>
                <p className="text-sm">{item.description}</p>
              </div>
              {/* <Separator orientation="vertical" className="h-14" /> */}
              <div className="flex flex-grow">
                {item.content}
              </div>
            </li>
          ))}
        </ol>
      </div>

    </PageLayout>
  );
}

type CodeLine = { value: string, className?: string }[];

export function CodeSnippet(props: { type: string, content: CodeLine[] }) {
  return (
    <div className="bg-muted rounded-xl overflow-hidden">
      <div className="text-muted-foreground font-medium py-1 pl-4 pr-1 border-b dark:border-black text-sm flex justify-between items-center">
        <h5 className="font-medium flex items-center gap-2">
          <Terminal className="w-4 h-4" />
          {props.type}
        </h5>
        <CopyButton content={props.content.map(line =>
          line.map(segment => segment.value).join(' ')
        ).join('\n')} />
      </div>
      <div className="font-mono font-medium p-4 pl-5 pb-5 max-h-60 overflow-x-auto whitespace-nowrap">
        {props.content.map((line, index) => (
          <div key={index} className="whitespace-nowrap">
            {line.map((content) => (
              <span key={content.value} className={content.className}>
                {content.value}{" "}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
