'use client';

import { Link } from "@/components/link";
import { Typography } from "@stackframe/stack-ui";
import dynamic from "next/dynamic";
import { use, useRef } from "react";
import { GlobeMethods } from "react-globe.gl";
import { PageLayout } from "../page-layout";
import styles from './setup-page.module.css';
const countriesPromise = import('./country-data.geo.json');

const Globe = dynamic(() => import('react-globe.gl').then((mod) => mod.default), { ssr: false });

export default function SetupPage() {
  const countries = use(countriesPromise);
  const globeEl = useRef<GlobeMethods | undefined>(undefined);

  return (
    <PageLayout>
      <div className="flex gap-4 items-center">
        <div className="w-[200px] h-[200px] relative">
          <div className="absolute inset-0 flex items-center justify-center z-0">
            <div className={`w-[120px] h-[120px] rounded-full bg-[rgb(107,93,247)]/10 ${styles.rippleAnimation}`}></div>
            <div className={`absolute w-[140px] h-[140px] rounded-full bg-[rgb(107,93,247)]/10 ${styles.rippleAnimation2}`}></div>
            <div className={`absolute w-[160px] h-[160px] rounded-full bg-[rgb(107,93,247)]/10 ${styles.rippleAnimation3}`}></div>
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

        <div className="flex flex-col">
          <Typography type="h2">
            Setup Stack Auth in your codebase
          </Typography>
          <Typography>
            <Link href="https://docs.stack-auth.com/" target="_blank" rel="noopener noreferrer">Documentation</Link>
          </Typography>
        </div>
      </div>
    </PageLayout>
  );
}
