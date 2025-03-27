'use client';

import { Button, Typography } from "@stackframe/stack-ui";
import { Book } from "lucide-react";
import dynamic from "next/dynamic";
import { use, useRef } from "react";
import { GlobeMethods } from "react-globe.gl";
import { PageLayout } from "../../page-layout";
import styles from './setup-page.module.css';
const countriesPromise = import('../(data)/country-data.geo.json');

const Globe = dynamic(() => import('react-globe.gl').then((mod) => mod.default), { ssr: false });

export default function SetupPage() {
  const countries = use(countriesPromise);
  const globeEl = useRef<GlobeMethods | undefined>(undefined);

  return (
    <PageLayout>
      <div className="flex gap-4 items-center">
        <div className="w-[200px] h-[200px] relative">
          <div className="absolute inset-0 flex items-center justify-center z-0">
            <div className={styles.globePulse}></div>
            <div className={`absolute ${styles.globePulse} ${styles.globePulse2}`}></div>
            <div className={`absolute ${styles.globePulse} ${styles.globePulse3}`}></div>
          </div>

          <div className="relative z-10 flex items-center justify-center w-full h-full">
            <Globe
              ref={globeEl}
              onGlobeReady={() => {
                if (globeEl.current) {
                  const controls = globeEl.current.controls();
                  controls.autoRotate = true;
                  controls.enableZoom = false;
                  controls.enablePan = false;
                  controls.enableRotate = false;
                }
              }}
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
    </PageLayout>
  );
}
