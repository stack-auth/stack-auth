import { useWaitForIdle } from '@/hooks/use-wait-for-idle';
import { useThemeWatcher } from '@/lib/theme';
import { cn } from '@/lib/utils';
import useResizeObserver from '@react-hook/resize-observer';
import { useUser } from '@stackframe/stack';
import { use } from '@stackframe/stack-shared/dist/utils/react';
import { getFlagEmoji } from '@stackframe/stack-shared/dist/utils/unicode';
import dynamic from 'next/dynamic';
import { RefObject, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { GlobeMethods } from 'react-globe.gl';
import { MeshLambertMaterial, Vector3 } from 'three';

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

function calculateGlobeVisualDiameter(globeRef: RefObject<GlobeMethods | undefined>): number {
  if (!globeRef.current) return 0;

  const current = globeRef.current;
  const globeRadius = current.getGlobeRadius();
  const camera = current.camera();
  const renderer = current.renderer();
  const centerWorld = new Vector3(0, 0, 0);
  const cameraPosition = camera.position;
  const distanceToCenter = centerWorld.distanceTo(cameraPosition);
  const fov = (camera as any).fov * (Math.PI / 180);
  const screenHeight = renderer.domElement.height;
  const visualRadius = (globeRadius / distanceToCenter) * (screenHeight / (2 * Math.tan(fov / 2)));
  return visualRadius * 1.065; // Return diameter
}

export function GlobeSection({ countryData, totalUsers, children }: {countryData: Record<string, number>, totalUsers: number, children?: React.ReactNode}) {
  const hasWaitedForIdle = useWaitForIdle(1000, 5000);
  if (!hasWaitedForIdle) {
    return <GlobeLoading devReason="waiting for cpu" />;
  }
  return (
    <Suspense fallback={<GlobeLoading devReason="suspended" />}>
      <GlobeSectionInner countryData={countryData} totalUsers={totalUsers} />
    </Suspense>
  );
}

// Global start time for syncing animations across component remounts
const pageLoadTime = typeof performance !== 'undefined' ? performance.now() : 0;

function GlobeLoading(props: { devReason: string, className?: string }) {
  // Calculate negative delay to sync animation with page load time
  // This ensures animations don't restart when component remounts
  const [syncDelay, setSyncDelay] = useState(0);

  useLayoutEffect(() => {
    const elapsed = performance.now() - pageLoadTime;
    setSyncDelay(-elapsed);
  }, []);

  // Helper to create synced animation style
  const syncedAnimation = (duration: number, reverse = false) => ({
    animationDelay: `${syncDelay}ms`,
    animationDuration: `${duration}s`,
    animationTimingFunction: 'ease-in-out',
    animationIterationCount: 'infinite',
    animationDirection: reverse ? 'alternate' : 'alternate-reverse',
  });

  return (
    <div className={cn("w-full aspect-square flex items-center justify-center", props.className)}>
      <div className="relative w-[70%] aspect-square">
        {/* Main globe circle with gradient */}
        <div
          className="absolute inset-0 rounded-full bg-gradient-to-br from-foreground/[0.06] via-foreground/[0.03] to-transparent animate-pulse"
          style={{ animationDelay: `${syncDelay}ms` }}
        />

        {/* Rotating orbit ring 1 */}
        <div
          className="absolute inset-[-5%] rounded-full border border-foreground/[0.08] animate-spin"
          style={{
            transform: 'rotateX(70deg)',
            ...syncedAnimation(2.5),
          }}
        />

        {/* Rotating orbit ring 2 */}
        <div
          className="absolute inset-[5%] rounded-full border border-dashed border-foreground/[0.06] animate-spin"
          style={{
            transform: 'rotateX(70deg) rotateZ(30deg)',
            ...syncedAnimation(4, true),
          }}
        />

        {/* Equator line */}
        <div
          className="absolute inset-[10%] rounded-full border border-foreground/[0.05]"
          style={{ transform: 'rotateX(80deg)' }}
        />

        {/* Meridian lines */}
        <div className="absolute inset-[15%] rounded-full border border-foreground/[0.04]" />
        <div
          className="absolute inset-[20%] rounded-full border border-foreground/[0.04]"
          style={{ transform: 'rotateY(60deg)' }}
        />

        {/* Center glow */}
        <div
          className="absolute inset-[30%] rounded-full bg-foreground/[0.02] blur-xl animate-pulse"
          style={{ animationDelay: `${syncDelay}ms` }}
        />

        {/* Shimmer effect */}
        <div className="absolute inset-0 rounded-full overflow-hidden">
          <div
            className="absolute inset-0 bg-gradient-to-r from-transparent via-foreground/[0.03] to-transparent animate-[shimmer_0.8s_ease-in-out_infinite]"
            style={{
              transform: 'translateX(-100%)',
              animationDelay: `${syncDelay}ms`,
            }}
          />
        </div>

        {/*process.env.NODE_ENV === "development" && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[10px] text-muted-foreground/50">{props.devReason}</span>
          </div>
        )*/}
      </div>
    </div>
  );
}

function GlobeSectionInner({ countryData, totalUsers, children }: {countryData: Record<string, number>, totalUsers: number, children?: React.ReactNode}) {
  const countries = use(countriesPromise);
  const globeRef = useRef<GlobeMethods | undefined>(undefined);

  const globeWindowRef = useRef<HTMLDivElement>(null);
  const globeWindowSize = useSize(globeWindowRef);
  const globeContainerRef = useRef<HTMLDivElement>(null);
  const globeContainerSize = useSize(globeContainerRef);
  const sectionContainerRef = useRef<HTMLDivElement>(null);
  const sectionContainerSize = useSize(sectionContainerRef);

  // Simplified sizing for the new layout - only use width
  const globeSize = globeContainerSize?.width ?? 400;

  // Calculate camera distance (zoom) based on canvas width
  // Linear interpolation: zoom decreases as width increases (less aggressive slope)
  // Lower zoom values = larger globe size
  // - Canvas width 350: Hide globe
  // - Canvas width 355: zoom = 360
  // - Canvas width 500: zoom = 309
  // Formula: zoom = 484 - 0.35 * width (for width >= 355)
  const canvasWidth = globeContainerSize?.width ?? 0;
  const GLOBE_MIN_WIDTH = 350;

  const shouldShowGlobe = canvasWidth >= GLOBE_MIN_WIDTH;

  // Calculate zoom based on width
  // For widths >= 355, use linear formula: zoom = 484 - 0.35 * width
  // For widths between 350-355, use 360 (same as at 355px)
  const cameraDistance = canvasWidth >= 355
    ? 484 - 0.35 * canvasWidth
    : 360; // For 350-355 range, use 360

  // Calculate border size using exact same formula structure as cameraDistance
  // Uses same scale factor (0.35) but inverted direction (increases as width increases)
  // - Canvas width 350: Hide border
  // - Canvas width 355: borderSize = BORDER_BASE_SIZE
  // - Canvas width 500: borderSize = BORDER_BASE_SIZE + 0.35 * (500 - 355)
  // Formula: borderSize = BORDER_BASE_SIZE + 0.35 * (width - 355) for width >= 355
  const BORDER_BASE_SIZE = 180; // Only variable to change - base size at 355px
  const borderSize = canvasWidth >= 355
    ? BORDER_BASE_SIZE + 0.35 * (canvasWidth - 355)
    : canvasWidth >= GLOBE_MIN_WIDTH
      ? BORDER_BASE_SIZE
      : 0;

  const [hexSelectedCountry, setHexSelectedCountry] = useState<{ code: string, name: string } | null>(null);
  const [polygonSelectedCountry, setPolygonSelectedCountry] = useState<{ code: string, name: string } | null>(null);
  const selectedCountry = hexSelectedCountry ?? polygonSelectedCountry ?? null;
  const [previousSelectedCountry, setPreviousSelectedCountry] = useState<{ code: string, name: string } | null>(null);
  const lastSelectedCountry = selectedCountry ?? previousSelectedCountry;
  const [borderSizeFromGlobe, setBorderSizeFromGlobe] = useState<number>(0);

  useEffect(() => {
    if (selectedCountry) {
      setPreviousSelectedCountry(selectedCountry);
    }
  }, [selectedCountry]);

  const resumeRenderIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const resumeRender = () => {
    // the globe takes up a lot of CPU while it's rendering. by pausing it, we can essentially tell the globe it won't have to re-render
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


  // Create a custom material without specular highlights
  const globeMaterial = useMemo(() => {
    return new MeshLambertMaterial({
      emissive: 0x000000,
      color: 0x00000000,
      transparent: false,
      opacity: 1,
      depthWrite: true,
      polygonOffset: true,
    });
  }, []);

  // Chromium's WebGL is much faster than other browsers, so we can do some extra animations
  const [isFastEngine, setIsFastEngine] = useState<boolean | null>(null);
  useEffect(() => {
    setIsFastEngine("chrome" in window && window.navigator.userAgent.includes("Chrome") && !window.navigator.userAgent.match(/Android|Mobi/));
  }, []);

  // Update camera position when globe size changes (e.g., window resize)
  useEffect(() => {
    if (!globeRef.current || !shouldShowGlobe) return;

    const controls = globeRef.current.controls();
    controls.maxDistance = cameraDistance;
    controls.minDistance = cameraDistance;
    globeRef.current.camera().position.z = cameraDistance;
  }, [cameraDistance, shouldShowGlobe]);


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

  const tooltipRef = useRef<HTMLDivElement>(null);

  const [globeReady, setGlobeReady] = useState(false);

  // set globeReady to true after a bit in case onGlobeReady was not called
  useEffect(() => {
    const timeout = setTimeout(() => {
      setGlobeReady(true);
    }, 5000);
    return () => clearTimeout(timeout);
  }, []);

  return (
    <div className='relative w-full aspect-square'>
      <div inert className='absolute inset-0 pointer-events-none'>
        <GlobeLoading
          devReason="not ready"
          className={cn(
            'transition-opacity duration-500 delay-1000',
            globeReady ? 'opacity-0' : 'opacity-100',
          )}
        />
      </div>
      <div
        ref={sectionContainerRef}
        className={cn(
          'relative flex items-center justify-center w-full h-full transition-all duration-500',
          globeReady ? 'opacity-100' : 'opacity-0',
        )}
      >
        {/* Hidden measurement div - always rendered to track size */}
        <div ref={globeContainerRef} className='absolute inset-0 pointer-events-none' aria-hidden="true" />

        {/* Globe Container - Premium 3D */}
        {shouldShowGlobe && (
          <div className='relative w-full h-full flex items-center justify-center'>
            {/* Border container - same approach as globe */}
            <div inert className='absolute top-0 left-0 right-0 pointer-events-none flex items-center justify-center'>
              {/* Inner square div - contain behavior (square, fills either width or height) */}
              <div className='relative' style={{ aspectRatio: '1', width: '100%', maxWidth: '100%', maxHeight: '100%' }}>
                {/* Border div - size calculated from actual globe visual size */}
                {borderSizeFromGlobe > 0 && (
                  <div
                    className='absolute rounded-full border-sky-300/40 border border-solid'
                    style={{
                      width: `${borderSizeFromGlobe}px`,
                      height: `${borderSizeFromGlobe}px`,
                      left: '50%',
                      top: '50%',
                      transform: 'translate(-50%, -50%)',
                    }}
                  />
                )}
                {borderSizeFromGlobe > 0 && (
                  <div
                    className='absolute rounded-full border-sky-300/40 border-2 border-solid blur-sm'
                    style={{
                      width: `${borderSizeFromGlobe}px`,
                      height: `${borderSizeFromGlobe}px`,
                      left: '50%',
                      top: '50%',
                      transform: 'translate(-50%, -50%)',
                    }}
                  />
                )}
              </div>
            </div>
            <div
              className='relative w-full h-full'
              style={{ aspectRatio: '1' }}
              onMouseEnter={() => {
                if (globeRef.current) {
                  globeRef.current.controls().autoRotate = false;
                }
              }}
              onMouseMoveCapture={(e) => {
                resumeRender();
                if (tooltipRef.current) {
                  tooltipRef.current.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
                }
              }}
              onMouseLeave={() => {
                setHexSelectedCountry(null);
                setPolygonSelectedCountry(null);
                if (globeRef.current) {
                  //globeRef.current.controls().autoRotate = true;
                }
              }}
              onTouchMove={resumeRender}
            >
              {/* Subtle glow effect */}
              <div className='absolute inset-0 bg-gradient-radial from-primary/10 via-transparent to-transparent blur-3xl opacity-30' />

              {mounted && isFastEngine !== null && (
                <div className='w-full h-full flex justify-center'>
                  <Globe
                    key={errorRefreshCount}
                    ref={globeRef}
                    backgroundColor='rgba(0,0,0,0)'
                    // globeImageUrl={globeImages[theme]}
                    globeMaterial={globeMaterial}
                    width={globeSize}
                    showGraticules
                    showAtmosphere={false}
                    height={globeSize}
                    onGlobeReady={() => {
                      console.log("globe ready");
                      setGlobeReady(true);

                      const current = globeRef.current;
                      if (current) {

                        const controls = current.controls();
                        controls.autoRotate = false;
                        controls.autoRotateSpeed = 0.5;
                        controls.maxDistance = cameraDistance;
                        controls.minDistance = cameraDistance;
                        controls.dampingFactor = 0.15;
                        controls.enableZoom = false;
                        controls.enableRotate = true;
                        current.camera().position.z = cameraDistance;

                        // Calculate border size from actual globe visual size
                        const visualDiameter = calculateGlobeVisualDiameter(globeRef);
                        setBorderSizeFromGlobe(visualDiameter);
                      }


                      resumeRender();
                    }}
                    onZoom={() => {
                      // Update border size when camera/view changes (rotation, etc.)
                      const visualDiameter = calculateGlobeVisualDiameter(globeRef);
                      setBorderSizeFromGlobe(visualDiameter);
                      resumeRender();
                    }}
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

                      if (highlight) return theme === 'dark' ? "#ffffff" : "#1e293b";

                      // Base color for all countries - theme-aware
                      if (Number.isNaN(value) || value === null || maxColorValue < 0.0001) {
                      // Dark mode: light slate, Light mode: darker slate for visibility
                        return theme === 'dark' ? "#7d93bc" : "#64748b";
                      }

                      const scaled = value / maxColorValue;
                      if (theme === 'dark') {
                      // Dark mode: vibrant teal/emerald that pops against slate
                      // Goes from teal-400 to emerald-300 as scaled increases
                        return `hsl(${168 - 8 * scaled}, ${70 + 15 * scaled}%, ${55 + 20 * scaled}%)`;
                      } else {
                      // Light mode: rich teal/emerald that stands out against slate
                      // Goes from teal-600 to emerald-500 as scaled increases
                        return `hsl(${168 - 8 * scaled}, ${70 + 20 * scaled}%, ${35 + 10 * scaled}%)`;
                      }
                    }}
                    onHexPolygonHover={(d: any) => {
                    resumeRender();
                    if (d) {
                      setHexSelectedCountry({ code: d.properties.ISO_A2_EH, name: d.properties.NAME });
                    } else {
                      setHexSelectedCountry(null);
                    }
                    }}
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
                      //globeRef.current.controls().autoRotate = true;
                      // globeRef.current.pointOfView({ altitude: 4.0 }, 2000);
                    }
                    }}
                  />
                </div>
              )}
              <div ref={globeWindowRef} className='absolute inset-0 pointer-events-none' />

            </div>
          </div>
        )}
      </div>
      {/* Tooltip */}
      {lastSelectedCountry && (
        <div
          ref={tooltipRef}
          className={cn(
                    "fixed top-0 left-0 z-[100] min-w-[180px] p-4 rounded-2xl shadow-xl bg-background/95 backdrop-blur-xl ring-1 ring-foreground/[0.08] pointer-events-none",
                    selectedCountry ? 'opacity-100' : 'opacity-0 transition-opacity duration-300 ease-out',
                  )}
        >
          <div className="flex items-center gap-2.5 font-semibold mb-3 pb-3 border-b border-foreground/[0.06]">
            <span className="text-xl leading-none">
              {lastSelectedCountry.code.match(/^[a-zA-Z][a-zA-Z]$/) ? getFlagEmoji(lastSelectedCountry.code) : '🌍'}
            </span>
            <span className="truncate text-sm">{lastSelectedCountry.name}</span>
          </div>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between items-center gap-6">
              <span className="text-muted-foreground">Users</span>
              <span className="font-mono font-semibold text-foreground tabular-nums">
                {(countryData[lastSelectedCountry.code] ?? 0).toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between items-center gap-6">
              <span className="text-muted-foreground">Share</span>
              <span className="font-mono font-semibold text-blue-500 dark:text-blue-400 tabular-nums">
                {totalUsers > 0
                  ? `${((countryData[lastSelectedCountry.code] ?? 0) / totalUsers * 100).toFixed(1)}%`
                  : 'N/A'}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
