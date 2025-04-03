'use client';

import { useThemeWatcher } from '@/lib/theme';
import { Button, Typography } from "@stackframe/stack-ui";
import { Book } from "lucide-react";
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

  const [setupCode, setSetupCode] = useState<string | undefined>(undefined);

  useEffect(() => {
    const fetchSetupCode = async () => {
      const code = await adminApp.createSetupCode();
      setSetupCode(code.code);
    };
    fetchSetupCode().catch(console.error);
  }, [adminApp]);

  return (
    <PageLayout width={1000}>
      <div className="flex gap-4 justify-center items-center border rounded-2xl">
        <div className="w-[200px] h-[200px] relative">
          <div className="absolute inset-0 flex items-center justify-center z-0">
            <div className={styles.globePulse}></div>
            <div className={`absolute ${styles.globePulse} ${styles.globePulse2}`}></div>
            <div className={`absolute ${styles.globePulse} ${styles.globePulse3}`}></div>
          </div>

          <div className="relative z-10 flex items-center justify-center w-full h-full">
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
                width={150}
                height={150}
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

      <div className="flex gap-4 justify-center">
        {[{
          name: 'Next.js',
          src: '/next-logo.svg',
        }, {
          name: 'React',
          src: '/react-logo.svg',
        }, {
          name: 'JavaScript',
          src: '/javascript-logo.svg',
        }].map(({ name, src }) => (
          <Button variant={name === 'Next.js' ? 'secondary' : 'plain'} className='h-12 w-40 flex items-center justify-center gap-2' key={name}>
            <Image src={src} alt={name} width={30} height={30} />
            <Typography>{name}</Typography>
          </Button>
        ))}
      </div>

      <div className="flex gap-4 justify-center">
        <Typography>
          Code: {setupCode}
        </Typography>
      </div>

      <div className="flex">
        <ol className="relative text-gray-500 border-s border-gray-200 dark:border-gray-700 dark:text-gray-400">
          {[
            {
              step: 1,
              title: "Personal Info",
              description: "Step details here",
              isCompleted: true
            },
            {
              step: 2,
              title: "Account Info",
              description: "Step details here",
              isCompleted: false
            },
            {
              step: 3,
              title: "Review",
              description: "Step details here",
              isCompleted: false
            },
            {
              step: 4,
              title: "Confirmation",
              description: "Step details here",
              isCompleted: false
            }
          ].map((item, index) => (
            <li key={item.step} className={`${index < 3 ? "mb-10 " : ""}ms-6`}>
              <span className={`absolute flex items-center justify-center w-8 h-8 ${item.isCompleted ? "bg-green-200 dark:bg-green-900" : "bg-gray-100 dark:bg-gray-700"} rounded-full -start-4 ring-4 ring-white dark:ring-gray-900`}>
                <span className={`${item.isCompleted ? "text-green-500 dark:text-green-400" : "text-gray-500 dark:text-gray-400"} font-medium`}>{item.step}</span>
              </span>
              <h3 className="font-medium leading-tight">{item.title}</h3>
              <p className="text-sm">{item.description}</p>
            </li>
          ))}
        </ol>
      </div>

    </PageLayout>
  );
}
