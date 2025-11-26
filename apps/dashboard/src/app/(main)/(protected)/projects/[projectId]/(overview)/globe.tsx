import { useThemeWatcher } from '@/lib/theme';
import useResizeObserver from '@react-hook/resize-observer';
import { useUser } from '@stackframe/stack';
import { use } from '@stackframe/stack-shared/dist/utils/react';
import { getFlagEmoji } from '@stackframe/stack-shared/dist/utils/unicode';
import dynamic from 'next/dynamic';
import { RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { GlobeMethods } from 'react-globe.gl';

export const globeImages = {
  light: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAAaADAAQAAAABAAAAAQAAAAD5Ip3+AAAADUlEQVQIHWO48vjffwAI+QO1AqIWWgAAAABJRU5ErkJggg==',
  dark: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAAaADAAQAAAABAAAAAQAAAAD5Ip3+AAAADUlEQVQIHWPgF9f8DwAB1wFPLWQXmAAAAABJRU5ErkJggg=='
};

// https://github.com/vasturiano/react-globe.gl/issues/1#issuecomment-554459831
const Globe = dynamic(() => import('react-globe.gl').then((mod) => mod.default), { ssr: false });
const countriesPromise = import('./country-data.geo.json');

function useSize(target: RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState<DOMRectReadOnly>();

  useLayoutEffect(() => {
    setSize(target.current?.getBoundingClientRect());
  }, [target]);

  // Where the magic happens
  useResizeObserver(target, (entry) => setSize(entry.contentRect));
  return size;
}

export function GlobeSection({ countryData, totalUsers, children }: {countryData: Record<string, number>, totalUsers: number, children?: React.ReactNode}) {
  const countries = use(countriesPromise);
  const globeRef = useRef<GlobeMethods | undefined>(undefined);

  const globeWindowRef = useRef<HTMLDivElement>(null);
  const globeWindowSize = useSize(globeWindowRef);
  const globeContainerRef = useRef<HTMLDivElement>(null);
  const globeContainerSize = useSize(globeContainerRef);
  const sectionContainerRef = useRef<HTMLDivElement>(null);
  const sectionContainerSize = useSize(sectionContainerRef);

  // Simplified sizing for the new layout
  const globeSize = [
    globeContainerSize?.width ?? 400,
    globeContainerSize?.height ?? 400,
  ];

  const [hexSelectedCountry, setHexSelectedCountry] = useState<{ code: string, name: string } | null>(null);
  const [polygonSelectedCountry, setPolygonSelectedCountry] = useState<{ code: string, name: string } | null>(null);
  const selectedCountry = hexSelectedCountry ?? polygonSelectedCountry ?? null;

  const [isGlobeReady, setIsGlobeReady] = useState(false);

  const resumeRenderIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const resumeRender = () => {
    if (!globeRef.current) {
      return;
    }
    const old = resumeRenderIntervalRef.current;
    if (old !== null) {
      clearTimeout(old);
    }

    // pause again after a bit
    resumeRenderIntervalRef.current = setTimeout(() => {
      globeRef.current?.pauseAnimation();  // conditional, because globe may have been destroyed
      resumeRenderIntervalRef.current = null;
    }, 1000);

    // resume animation
    // we only resume if we haven't already resumed before to prevent a StackOverflow: resumeAnimation -> onZoom -> resumeRender -> resumeAnimation, etc etc
    if (old === null) {
      globeRef.current.resumeAnimation();
    }
  };

  const user = useUser({ or: "redirect" });
  const displayName = user.displayName ?? user.primaryEmail;

  const { theme, mounted } = useThemeWatcher();

  // Chromium's WebGL is much faster than other browsers, so we can do some extra animations
  const [isFastEngine, setIsFastEngine] = useState<boolean | null>(null);
  useEffect(() => {
    setIsFastEngine("chrome" in window && window.navigator.userAgent.includes("Chrome") && !window.navigator.userAgent.match(/Android|Mobi/));
  }, []);

  // calculate color values for each country
  const totalUsersInCountries = Object.values(countryData).reduce((acc, curr) => acc + curr, 0);
  const totalPopulationInCountries = countries.features.reduce((acc, curr) => acc + curr.properties.POP_EST, 0);
  const colorValues = new Map(countries.features.map((country) => {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    const countryUsers = countryData[country.properties.ISO_A2_EH] ?? 0;
    const countryPopulation = country.properties.POP_EST;
    if (countryUsers === 0) return [country.properties.ISO_A2_EH, null] as const;

    // we want to get the lowest proportion such that there's a 95% chance that it's higher than the actual
    // proportion (given enough samples)
    // my math sucks, someone please correct me if I'm wrong (but the colors look nice)
    const observedProportion = countryUsers / totalUsersInCountries;
    const standardError = Math.sqrt(observedProportion * (1 - observedProportion) / totalUsersInCountries);
    const zScore = 1.645; // one-sided 95% confidence interval

    const proportionLowerBound = Math.max(0, observedProportion - zScore * standardError);  // how likely is it that a random user is in this country? (with 95% confidence lower bound from above)
    const populationProportion = countryPopulation / totalPopulationInCountries;  // how likely is it that a random person is in this country?
    const likelihoodRatio = proportionLowerBound / populationProportion;  // how much more likely is it for a random user to be in this country than a random person?

    const colorValue = Math.max(0, Math.log(100 * likelihoodRatio));

    return [country.properties.ISO_A2_EH, colorValue] as const;
  }));
  const maxColorValue = Math.max(0.001, ...[...colorValues.values()].filter((v): v is number => v !== null));

  // There is a react-globe error that we haven't been able to track down, so we refresh it whenever it occurs
  // TODO fix it without a workaround
  const [errorRefreshCount, setErrorRefreshCount] = useState(0);
  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      if (event.error?.message?.includes("Cannot read properties of undefined (reading 'count')")) {
        console.error("Globe rendering error — refreshing it", event);
        setErrorRefreshCount(e => e + 1);
        if (process.env.NODE_ENV === "development") {
          setTimeout(() => {
            alert("Globe rendering error — it has now been refreshed. TODO let's fix this");
          }, 1000);
        }
      }
    };
    window.addEventListener('error', handleError);
    return () => window.removeEventListener('error', handleError);
  }, []);

  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  return (
    <div className='w-full'>
      <div
        ref={sectionContainerRef}
        className='relative flex items-center justify-center'
      >
        {/* Globe Container - Premium 3D */}
        <div className='relative flex-shrink-0'>
          <div
            ref={globeContainerRef}
            className='relative'
            style={{
              width: Math.min(globeWindowSize?.width ?? 600, 600),
              height: Math.min(globeWindowSize?.height ?? 600, 600),
            }}
            onMouseEnter={() => {
              if (globeRef.current) {
                globeRef.current.controls().autoRotate = false;
              }
            }}
            onMouseMove={(e) => {
              resumeRender();
              setTooltipPos({ x: e.clientX, y: e.clientY });
            }}
            onMouseLeave={() => {
              setHexSelectedCountry(null);
              setPolygonSelectedCountry(null);
              if (globeRef.current) {
                globeRef.current.controls().autoRotate = true;
              }
            }}
            onTouchMove={resumeRender}
          >
            {/* Subtle glow effect */}
            <div className='absolute inset-0 bg-gradient-radial from-primary/10 via-transparent to-transparent blur-3xl opacity-30' />

            {!isGlobeReady && (
              <div className='absolute inset-0 flex items-center justify-center'>
                <PlanetLoader />
              </div>
            )}
            {mounted && isFastEngine !== null && (
              <Globe
                key={errorRefreshCount}
                ref={globeRef}
                backgroundColor='rgba(0,0,0,0)'
                globeImageUrl={globeImages[theme]}
                width={globeSize[0] ?? 600}
                height={globeSize[1] ?? 600}
                onGlobeReady={() => {
                  setTimeout(() => setIsGlobeReady(true), 100);
                  const current = globeRef.current;
                  if (!current) return;

                  const controls = current.controls();
                  controls.autoRotate = true;
                  controls.autoRotateSpeed = 0.5;
                  controls.maxDistance = 420;
                  controls.minDistance = 420;
                  controls.dampingFactor = 0.15;
                  controls.enableZoom = false;
                  controls.enableRotate = true;
                  current.camera().position.z = 420;
                  resumeRender();
                }}
                onZoom={resumeRender}
                animateIn={isFastEngine}

                polygonsData={countries.features}
                polygonCapColor={() => "transparent"}
                polygonSideColor={() => "transparent"}
                polygonAltitude={0.001}
                onPolygonHover={(d: any) => {
                  resumeRender();
                  if (d) {
                    setPolygonSelectedCountry({ code: d.properties.ISO_A2_EH, name: d.properties.NAME });
                  } else {
                    setPolygonSelectedCountry(null);
                  }
                }}

                hexPolygonsData={countries.features}
                hexPolygonResolution={3}
                hexPolygonMargin={0.6}
                hexPolygonAltitude={(d: any) => {
                  const highlight = isFastEngine && d.properties.ISO_A2_EH === selectedCountry?.code;
                  return highlight ? 0.02 : 0.005;
                }}
                hexPolygonColor={(country: any) => {
                  const highlight = isFastEngine && country.properties.ISO_A2_EH === selectedCountry?.code;
                  const value = colorValues.get(country.properties.ISO_A2_EH) ?? null;

                  if (highlight) return "#ffffff";

                  // Base color for all countries
                  // Using slate-300 to allow white selection to stand out
                  if (Number.isNaN(value) || value === null || maxColorValue < 0.0001) {
                    return "#cbd5e1";
                  }

                  const scaled = value / maxColorValue;
                  // Interpolate from bright slate to almost white (max 95% lightness)
                  // This ensures the pure white highlight (100%) is always distinct
                  return `hsl(210, ${30 + 60 * scaled}%, ${75 + 20 * scaled}%)`;
                }}
                onHexPolygonHover={(d: any) => {
                  resumeRender();
                  if (d) {
                    setHexSelectedCountry({ code: d.properties.ISO_A2_EH, name: d.properties.NAME });
                  } else {
                    setHexSelectedCountry(null);
                  }
                }}

                atmosphereColor={'rgba(14, 165, 233, 0.3)'} // Sky blue, more subtle to let the globe blue show through
                atmosphereAltitude={0.2}
                onHexPolygonClick={(polygon: any, event: MouseEvent, coords: { lat: number, lng: number, altitude: number }) => {
                  resumeRender();
                  if (globeRef.current) {
                    globeRef.current.controls().autoRotate = false;
                    globeRef.current.pointOfView({ lat: coords.lat, lng: coords.lng }, 2000);
                  }
                }}
                onGlobeClick={() => {
                  resumeRender();
                  if (globeRef.current) {
                    globeRef.current.controls().autoRotate = true;
                    // globeRef.current.pointOfView({ altitude: 4.0 }, 2000);
                  }
                }}
              />
            )}
            <div ref={globeWindowRef} className='absolute inset-0 pointer-events-none' />

            {/* Tooltip */}
            {selectedCountry && (
              <div
                className="fixed z-[100] min-w-[180px] p-4 rounded-2xl shadow-xl bg-background/95 backdrop-blur-xl ring-1 ring-foreground/[0.08] pointer-events-none transition-all duration-75 ease-out"
                style={{
                  left: tooltipPos.x,
                  top: tooltipPos.y,
                  transform: 'translate(-50%, -100%) translateY(-12px)',
                }}
              >
                <div className="flex items-center gap-2.5 font-semibold mb-3 pb-3 border-b border-foreground/[0.06]">
                  <span className="text-xl leading-none">
                    {selectedCountry.code.match(/^[a-zA-Z][a-zA-Z]$/) ? getFlagEmoji(selectedCountry.code) : '🌍'}
                  </span>
                  <span className="truncate text-sm">{selectedCountry.name}</span>
                </div>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between items-center gap-6">
                    <span className="text-muted-foreground">Users</span>
                    <span className="font-mono font-semibold text-foreground tabular-nums">
                      {(countryData[selectedCountry.code] ?? 0).toLocaleString()}
                    </span>
                  </div>
                  <div className="flex justify-between items-center gap-6">
                    <span className="text-muted-foreground">Share</span>
                    <span className="font-mono font-semibold text-blue-500 dark:text-blue-400 tabular-nums">
                      {totalUsers > 0
                        ? `${((countryData[selectedCountry.code] ?? 0) / totalUsers * 100).toFixed(1)}%`
                        : 'N/A'}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function PlanetLoader() {
  return (
    <div className="flex flex-col items-center justify-center gap-4">
      {/* Simple elegant spinner */}
      <div className="relative w-16 h-16">
        {/* Outer ring */}
        <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-blue-500 border-r-purple-500 animate-spin" />
        {/* Inner glow */}
        <div className="absolute inset-2 rounded-full bg-gradient-to-br from-blue-500/20 to-purple-500/20 blur-md" />
      </div>

      {/* Simple text */}
      <p className="text-xs font-medium text-muted-foreground">Loading</p>
    </div>
  );
}
