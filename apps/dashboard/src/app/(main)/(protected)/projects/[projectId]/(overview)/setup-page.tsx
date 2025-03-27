'use client';

import dynamic from "next/dynamic";
import { use, useEffect, useRef } from "react";
import { GlobeMethods } from "react-globe.gl";
import { PageLayout } from "../page-layout";
const countriesPromise = import('./country-data.geo.json');

const Globe = dynamic(() => import('react-globe.gl').then((mod) => mod.default), { ssr: false });

export default function SetupPage() {
  const countries = use(countriesPromise);
  const globeEl = useRef<GlobeMethods | undefined>(undefined);

  useEffect(() => {
    if (globeEl.current) {
      // Enable auto-rotation and adjust the speed (default is 2.0)
      globeEl.current.controls().autoRotate = true;
      globeEl.current.controls().autoRotateSpeed = 0.35;
    }
  }, []);

  return (
    <PageLayout title="Setup">
      <div>
        <Globe
          ref={globeEl}
          backgroundColor="#00000000"
          polygonsData={countries.features}
          polygonCapColor={() => "transparent"}
          polygonSideColor={() => "transparent"}
          hexPolygonsData={countries.features}
          hexPolygonResolution={1}
          hexPolygonMargin={0.2}
          hexPolygonAltitude={0.003}
          atmosphereColor="#CBD5E0"
          atmosphereAltitude={0.2}
          width={200}
          height={200}
        />
      </div>
    </PageLayout>
  );
}
