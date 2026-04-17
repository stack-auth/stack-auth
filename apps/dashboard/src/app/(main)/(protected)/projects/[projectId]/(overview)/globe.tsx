import { useWaitForIdle } from '@/hooks/use-wait-for-idle';
import { useThemeWatcher } from '@/lib/theme';
import { cn } from '@/lib/utils';
import useResizeObserver from '@react-hook/resize-observer';
import { UserAvatar, useUser } from '@stackframe/stack';
import type { MetricsRecentUser } from '@stackframe/stack-shared/dist/interface/admin-metrics';
import { throwErr } from '@stackframe/stack-shared/dist/utils/errors';
import { use } from '@stackframe/stack-shared/dist/utils/react';
import { getFlagEmoji } from '@stackframe/stack-shared/dist/utils/unicode';
import dynamic from 'next/dynamic';
import { RefObject, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { GlobeMethods } from 'react-globe.gl';
import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  FrontSide,
  Group,
  Mesh,
  MeshLambertMaterial,
  SphereGeometry,
  Vector3,
} from 'three';

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

// --- Country point-in-polygon (used by the orbiting satellites to detect
// which country they're currently flying over). Ring coordinates are
// [longitude, latitude] per GeoJSON spec.
function pointInRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i] ?? throwErr(`point-in-ring: missing vertex ${i} in ring of length ${ring.length}`);
    const b = ring[j] ?? throwErr(`point-in-ring: missing vertex ${j} in ring of length ${ring.length}`);
    const xi = a[0] ?? 0;
    const yi = a[1] ?? 0;
    const xj = b[0] ?? 0;
    const yj = b[1] ?? 0;
    const intersect = ((yi > lat) !== (yj > lat))
      && (lng < ((xj - xi) * (lat - yi)) / ((yj - yi) || 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInFeature(lng: number, lat: number, feature: any): boolean {
  const bbox = feature.bbox;
  if (bbox && (lng < bbox[0] || lng > bbox[2] || lat < bbox[1] || lat > bbox[3])) {
    return false;
  }
  const geometry = feature.geometry;
  if (!geometry) return false;
  const { type, coordinates } = geometry;
  if (type === 'Polygon') {
    if (!coordinates[0] || !pointInRing(lng, lat, coordinates[0])) return false;
    for (let i = 1; i < coordinates.length; i++) {
      if (pointInRing(lng, lat, coordinates[i])) return false;
    }
    return true;
  }
  if (type === 'MultiPolygon') {
    for (const poly of coordinates) {
      if (!poly[0] || !pointInRing(lng, lat, poly[0])) continue;
      let inHole = false;
      for (let i = 1; i < poly.length; i++) {
        if (pointInRing(lng, lat, poly[i])) {
          inHole = true;
          break;
        }
      }
      if (!inHole) return true;
    }
    return false;
  }
  return false;
}

function findCountryAt(
  lat: number,
  lng: number,
  features: any[],
): { code: string, name: string } | null {
  for (const feature of features) {
    if (pointInFeature(lng, lat, feature)) {
      return {
        code: feature.properties.ISO_A2_EH,
        name: feature.properties.NAME,
      };
    }
  }
  return null;
}

// --- Build a small, cute satellite: chunky body + two solar panels +
// a little yellow antenna. All sizes are relative to `size`.
function createCuteSatelliteMesh(size: number, theme: 'light' | 'dark'): Group {
  const group = new Group();

  const bodyColor = theme === 'dark' ? 0xe2e8f0 : 0xf8fafc;
  const bodyEmissive = theme === 'dark' ? 0x1e3a8a : 0x60a5fa;
  const panelColor = theme === 'dark' ? 0x2563eb : 0x1d4ed8;
  const panelEmissive = theme === 'dark' ? 0x1e40af : 0x60a5fa;
  const antennaColor = 0xfacc15;
  const antennaEmissive = 0xf59e0b;

  const body = new Mesh(
    new BoxGeometry(size, size * 0.7, size * 0.7),
    new MeshLambertMaterial({
      color: bodyColor,
      emissive: bodyEmissive,
      emissiveIntensity: theme === 'dark' ? 0.35 : 0.15,
    }),
  );
  group.add(body);

  const panelGeometry = new BoxGeometry(size * 2.2, size * 0.08, size * 0.9);
  const panelMaterial = new MeshLambertMaterial({
    color: panelColor,
    emissive: panelEmissive,
    emissiveIntensity: theme === 'dark' ? 0.4 : 0.2,
  });
  const leftPanel = new Mesh(panelGeometry, panelMaterial);
  leftPanel.position.x = -(size * 1.55);
  group.add(leftPanel);
  const rightPanel = new Mesh(panelGeometry, panelMaterial);
  rightPanel.position.x = size * 1.55;
  group.add(rightPanel);

  const panelStrut = new Mesh(
    new CylinderGeometry(size * 0.05, size * 0.05, size * 1.2, 6),
    new MeshLambertMaterial({ color: 0x94a3b8 }),
  );
  panelStrut.rotation.z = Math.PI / 2;
  group.add(panelStrut);

  const dish = new Mesh(
    new SphereGeometry(size * 0.22, 10, 10, 0, Math.PI * 2, 0, Math.PI / 2),
    new MeshLambertMaterial({
      color: 0xf1f5f9,
      emissive: 0xcbd5f5,
      emissiveIntensity: 0.25,
      side: FrontSide,
    }),
  );
  dish.position.y = size * 0.45;
  dish.rotation.x = Math.PI;
  group.add(dish);

  const antenna = new Mesh(
    new ConeGeometry(size * 0.08, size * 0.45, 8),
    new MeshLambertMaterial({
      color: antennaColor,
      emissive: antennaEmissive,
      emissiveIntensity: 0.5,
    }),
  );
  antenna.position.y = size * 0.75;
  group.add(antenna);

  return group;
}

// --- Country visualization data (centroid + rough visual area on the
// sphere). Computed once from the GeoJSON features and memoised — driving
// both live-user avatar placement and the per-country avatar-count scaling.
type CountryVizData = {
  code: string,
  name: string,
  centroid: { lat: number, lng: number },
  bboxDegSize: number, // max(width, height) in degrees — used for spacing avatars
  visualArea: number,  // rough relative area (deg² × cos(lat)); used for count + size
};

function computeLargestRingCentroid(geometry: any): { lat: number, lng: number } | null {
  if (!geometry) return null;
  const { type, coordinates } = geometry;
  const rings: number[][][] = type === 'Polygon'
    ? [coordinates[0]].filter(Boolean)
    : type === 'MultiPolygon'
      ? coordinates.map((poly: number[][][]) => poly[0]).filter(Boolean)
      : [];
  if (rings.length === 0) return null;

  // Pick the largest ring by |signed area| so we don't get confused by tiny
  // outlying islands when looking for a country's visual anchor.
  let best: { ring: number[][], absArea: number, cx: number, cy: number } | null = null;
  for (const ring of rings) {
    if (ring.length < 3) continue;
    let area = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const a = ring[i] ?? throwErr(`ring vertex ${i} missing`);
      const b = ring[i + 1] ?? throwErr(`ring vertex ${i + 1} missing`);
      const x0 = a[0] ?? 0;
      const y0 = a[1] ?? 0;
      const x1 = b[0] ?? 0;
      const y1 = b[1] ?? 0;
      const cross = x0 * y1 - x1 * y0;
      area += cross;
      cx += (x0 + x1) * cross;
      cy += (y0 + y1) * cross;
    }
    area *= 0.5;
    const absArea = Math.abs(area);
    if (absArea < 1e-10) continue;
    if (!best || absArea > best.absArea) {
      best = { ring, absArea, cx: cx / (6 * area), cy: cy / (6 * area) };
    }
  }
  if (!best) return null;
  return { lng: best.cx, lat: best.cy };
}

function computeCountryVizData(features: any[]): Map<string, CountryVizData> {
  const out = new Map<string, CountryVizData>();
  for (const feature of features) {
    const code = feature.properties.ISO_A2_EH;
    const name = feature.properties.NAME;
    if (!code || code.length < 2) continue;
    const centroid = computeLargestRingCentroid(feature.geometry);
    if (!centroid) continue;
    const bbox = feature.bbox;
    if (!bbox) continue;
    const w = bbox[2] - bbox[0];
    const h = bbox[3] - bbox[1];
    const centerLat = (bbox[1] + bbox[3]) / 2;
    const cosLat = Math.max(0.1, Math.cos((centerLat * Math.PI) / 180));
    out.set(code, {
      code,
      name,
      centroid,
      bboxDegSize: Math.max(w, h),
      visualArea: w * h * cosLat,
    });
  }
  return out;
}

// How many live-user avatars to draw for a country, based on its visual
// area on the globe. Capped at 4 so crowded continents don't turn into
// confetti, and always <= number of sampled users for that country.
function avatarCountForCountry(visualArea: number, availableUsers: number): number {
  const ideal = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(visualArea / 60))));
  return Math.min(ideal, availableUsers);
}

// Avatar pixel size scales gently with the log of the country's visual
// area so small nations still get a readable bubble but big ones feel
// more "important".
function avatarSizeForCountry(visualArea: number): number {
  const size = 20 + Math.log(1 + Math.max(0, visualArea)) * 2;
  return Math.min(34, Math.max(18, Math.round(size)));
}

// Distribute N avatars around a centroid in a small ring, scaled relative
// to the country's bbox so they stay inside it on a zoomed-out globe.
function avatarOffsets(n: number, bboxDegSize: number): Array<{ dLat: number, dLng: number }> {
  if (n <= 1) return [{ dLat: 0, dLng: 0 }];
  const radius = Math.min(6, bboxDegSize * 0.18);
  const out: Array<{ dLat: number, dLng: number }> = [];
  for (let i = 0; i < n; i++) {
    const angle = (i / n) * Math.PI * 2 + (n === 2 ? Math.PI / 2 : 0);
    // Latitude gets half the radius: globe foreshortening makes vertical
    // offsets read stronger than horizontal ones.
    out.push({
      dLat: Math.sin(angle) * radius * 0.55,
      dLng: Math.cos(angle) * radius,
    });
  }
  return out;
}

type LiveAvatarPlacement = {
  key: string,             // stable React key
  user: MetricsRecentUser,
  country: CountryVizData,
  lat: number,
  lng: number,
  size: number,
  ringDelayMs: number,     // stagger pings across avatars so they don't all pulse in lockstep
};

function buildLiveAvatarPlacements(
  activeUsersByCountry: Record<string, MetricsRecentUser[]>,
  vizData: Map<string, CountryVizData>,
): LiveAvatarPlacement[] {
  const out: LiveAvatarPlacement[] = [];
  let avatarIndex = 0;
  for (const [rawCode, users] of Object.entries(activeUsersByCountry)) {
    if (users.length === 0) continue;
    const code = rawCode.toUpperCase();
    const country = vizData.get(code);
    if (!country) continue;
    const count = avatarCountForCountry(country.visualArea, users.length);
    if (count <= 0) continue;
    const size = avatarSizeForCountry(country.visualArea);
    const offsets = avatarOffsets(count, country.bboxDegSize);
    for (let i = 0; i < count; i++) {
      const user = users[i] ?? throwErr(`avatar slot ${i} out of range for country ${code}`);
      const offset = offsets[i] ?? throwErr(`offset slot ${i} out of range (count=${count})`);
      out.push({
        key: `${code}-${user.id}`,
        user,
        country,
        lat: country.centroid.lat + offset.dLat,
        lng: country.centroid.lng + offset.dLng,
        size,
        // staggered delay across all avatars (mod 1200 for 3 "phases")
        ringDelayMs: (avatarIndex++ * 400) % 1200,
      });
    }
  }
  return out;
}

type SatelliteHandle = {
  mesh: Group,
  orbitNormal: Vector3,
  orbitRight: Vector3,   // reference direction in orbit plane (phase 0 points here)
  orbitUp: Vector3,      // orbitNormal × orbitRight
  orbitRadius: number,
  orbitAltitude: number,
  angularSpeed: number,  // radians per millisecond
  phase: number,         // radians, added to angularSpeed * t
  currentCountry: { code: string, name: string } | null,
  currentUser: MetricsRecentUser | null,
  lastCountryCheckAt: number,
};

export function GlobeSection({ countryData, totalUsers, activeUsersByCountry, satelliteCount, children }: {countryData: Record<string, number>, totalUsers: number, activeUsersByCountry?: Record<string, MetricsRecentUser[]>, satelliteCount?: number, children?: React.ReactNode}) {
  const hasWaitedForIdle = useWaitForIdle(1000, 5000);
  if (!hasWaitedForIdle) {
    return <GlobeLoading devReason="waiting for cpu" />;
  }
  return (
    <Suspense fallback={<GlobeLoading devReason="suspended" />}>
      <GlobeSectionInner
        countryData={countryData}
        totalUsers={totalUsers}
        activeUsersByCountry={activeUsersByCountry ?? {}}
        satelliteCount={satelliteCount ?? 2}
      />
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
          className="absolute inset-0 rounded-full bg-gradient-to-br from-sky-500/[0.09] via-sky-400/[0.05] to-transparent animate-pulse dark:from-sky-400/[0.12] dark:via-sky-500/[0.06]"
          style={{ animationDelay: `${syncDelay}ms` }}
        />

        {/* Rotating orbit ring 1 */}
        <div
          className="absolute inset-[-5%] rounded-full border border-sky-400/15 dark:border-sky-400/20 animate-spin"
          style={{
            transform: 'rotateX(70deg)',
            ...syncedAnimation(2.5),
          }}
        />

        {/* Rotating orbit ring 2 */}
        <div
          className="absolute inset-[5%] rounded-full border border-dashed border-sky-400/12 dark:border-sky-400/14 animate-spin"
          style={{
            transform: 'rotateX(70deg) rotateZ(30deg)',
            ...syncedAnimation(4, true),
          }}
        />

        {/* Equator line */}
        <div
          className="absolute inset-[10%] rounded-full border border-sky-400/10 dark:border-sky-400/12"
          style={{ transform: 'rotateX(80deg)' }}
        />

        {/* Meridian lines */}
        <div className="absolute inset-[15%] rounded-full border border-sky-400/10 dark:border-sky-400/11" />
        <div
          className="absolute inset-[20%] rounded-full border border-sky-400/10 dark:border-sky-400/11"
          style={{ transform: 'rotateY(60deg)' }}
        />

        {/* Center glow */}
        <div
          className="absolute inset-[30%] rounded-full bg-sky-400/[0.06] dark:bg-sky-400/[0.08] blur-xl animate-pulse"
          style={{ animationDelay: `${syncDelay}ms` }}
        />

        {/* Shimmer effect */}
        <div className="absolute inset-0 rounded-full overflow-hidden">
          <div
            className="absolute inset-0 bg-gradient-to-r from-transparent via-sky-400/[0.06] dark:via-sky-400/[0.05] to-transparent animate-[shimmer_0.8s_ease-in-out_infinite]"
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

function GlobeSectionInner({ countryData, totalUsers, activeUsersByCountry, satelliteCount, children }: {countryData: Record<string, number>, totalUsers: number, activeUsersByCountry: Record<string, MetricsRecentUser[]>, satelliteCount: number, children?: React.ReactNode}) {
  const countries = use(countriesPromise);
  const globeRef = useRef<GlobeMethods | undefined>(undefined);

  // Precompute per-country anchors/areas once — the GeoJSON is static across
  // renders so this only recomputes on theme/refresh remounts (cheap either way).
  const countryVizData = useMemo(() => computeCountryVizData(countries.features), [countries]);
  const liveAvatars = useMemo(
    () => buildLiveAvatarPlacements(activeUsersByCountry, countryVizData),
    [activeUsersByCountry, countryVizData],
  );

  // Only `globeContainerSize` is actually consumed (drives zoom / border math
  // further down). The other refs/useSize calls were leftovers from an earlier
  // layout and each spawned a live ResizeObserver subscription for no reason.
  const globeContainerRef = useRef<HTMLDivElement>(null);
  const globeContainerSize = useSize(globeContainerRef);

  // Measure the parent element so the root can size itself to min(w, h) of
  // the available space (container queries misfire here on initial layout).
  const rootRef = useRef<HTMLDivElement>(null);
  const [parentBox, setParentBox] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const parent = rootRef.current?.parentElement;
    if (!parent) return;
    const update = () => {
      const r = parent.getBoundingClientRect();
      setParentBox({ w: r.width, h: r.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(parent);
    return () => ro.disconnect();
  }, []);
  const squareSize = Math.min(parentBox.w, parentBox.h);

  // Simplified sizing for the new layout - only use width
  const globeSize = globeContainerSize?.width ?? 400;

  // Calculate camera distance (zoom) based on canvas width
  // Linear interpolation: zoom decreases as width increases (less aggressive slope)
  // Lower zoom values = larger globe size
  // - Canvas width 350: Hide globe
  // - Canvas width 355: zoom = 360
  // - Canvas width 500: zoom = 309
  // - Canvas width >= 500: zoom stays at 309 so the globe keeps a constant
  //   visual fill ratio on widescreens instead of growing without bound and
  //   overflowing the canvas.
  const canvasWidth = globeContainerSize?.width ?? 0;
  const GLOBE_MIN_WIDTH = 350;

  const shouldShowGlobe = canvasWidth >= GLOBE_MIN_WIDTH;

  // Calculate zoom based on width
  // For widths >= 355, use linear formula clamped to a minimum distance.
  // For widths between 350-355, use 360 (same as at 355px)
  const MIN_CAMERA_DISTANCE = 261; // matches the value at width = 500
  const cameraDistance = canvasWidth >= 355
    ? Math.max(MIN_CAMERA_DISTANCE, 436 - 0.35 * canvasWidth)
    : 325; // For 350-355 range

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
  // Use polygon for tooltip (no gaps), hex just for visual highlighting
  const selectedCountry = polygonSelectedCountry;
  const [previousSelectedCountry, setPreviousSelectedCountry] = useState<{ code: string, name: string } | null>(null);
  const lastSelectedCountry = selectedCountry ?? previousSelectedCountry;
  const [borderSizeFromGlobe, setBorderSizeFromGlobe] = useState<number>(0);

  // Use ref for selectedCountry so accessor functions always read the current value
  // (react-globe.gl may cache accessor functions and not pick up closure changes)
  const selectedCountryRef = useRef(selectedCountry);
  selectedCountryRef.current = selectedCountry;

  // Sync hex highlighting with polygon hover (for visual consistency)
  useEffect(() => {
    if (polygonSelectedCountry) {
      setHexSelectedCountry(polygonSelectedCountry);
    } else {
      setHexSelectedCountry(null);
    }
  }, [polygonSelectedCountry]);

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


  // Create a custom material without specular highlights - theme-aware
  const globeMaterial = useMemo(() => {
    return new MeshLambertMaterial({
      emissive: theme === 'dark' ? 0x000000 : 0x000000,
      // Dark mode: deep blue-black; light mode: cool blue-gray (heat uses dark→light blue)
      color: theme === 'dark' ? 0x0a1220 : 0xe8ecf4,
      transparent: false, // Keep opaque to properly write to depth buffer and occlude far-side hexagons
      opacity: 1,
      depthWrite: true,
      depthTest: true,
      polygonOffset: true,
      side: FrontSide,
    });
  }, [theme]);

  // Chromium's WebGL is much faster than other browsers, so we can do some extra animations
  const [isFastEngine, setIsFastEngine] = useState<boolean | null>(null);
  useEffect(() => {
    setIsFastEngine("chrome" in window && window.navigator.userAgent.includes("Chrome") && !window.navigator.userAgent.match(/Android|Mobi/));
  }, []);

  // Update camera position when globe size changes (e.g., window resize)
  // Also trigger a re-render since the globe pauses animation to save CPU
  useEffect(() => {
    if (!globeRef.current || !shouldShowGlobe) return;

    const controls = globeRef.current.controls();
    controls.maxDistance = cameraDistance;
    controls.minDistance = cameraDistance;
    globeRef.current.camera().position.z = cameraDistance;

    // Update border size and trigger re-render when size changes
    const visualDiameter = calculateGlobeVisualDiameter(globeRef);
    setBorderSizeFromGlobe(visualDiameter);
    resumeRender();
  }, [cameraDistance, shouldShowGlobe, globeSize]);


  // Heatmap-style coloring: log-scaled user counts, normalized with a steeper curve so neighboring
  // countries with different volumes (e.g. US vs Canada vs Mexico) don't all land in the same band.
  const numericColorValues = countries.features
    .map((country) => {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      const countryUsers = countryData[country.properties.ISO_A2_EH] ?? 0;
      if (countryUsers === 0) return null;
      return Math.log1p(countryUsers);
    })
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);

  const percentileCap =
    numericColorValues.length === 0
      ? 0
      : numericColorValues[Math.min(numericColorValues.length - 1, Math.floor(0.985 * (numericColorValues.length - 1)))] ?? 0;

  const rawMaxColorValue = numericColorValues.length === 0 ? 0 : numericColorValues[numericColorValues.length - 1] ?? 0;
  // Blend toward the 98.5th percentile so a single outlier country doesn't flatten everyone else.
  const spreadMax = Math.max(0.001, 0.85 * rawMaxColorValue + 0.15 * percentileCap);

  const colorValues = new Map(countries.features.map((country) => {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    const countryUsers = countryData[country.properties.ISO_A2_EH] ?? 0;
    if (countryUsers === 0) return [country.properties.ISO_A2_EH, null] as const;

    const colorValue = Math.log1p(countryUsers);
    return [country.properties.ISO_A2_EH, colorValue] as const;
  }));
  const maxColorValue = spreadMax;

  // There is a react-globe error that we haven't been able to track down, so we refresh it whenever it occurs
  // TODO fix it without a workaround
  const [errorRefreshCount, setErrorRefreshCount] = useState(0);
  useEffect(() => {
    // Clear the deferred dev-only log if the component unmounts before it
    // fires, otherwise it'd run on whatever page the user navigated to.
    let devLogTimer: ReturnType<typeof setTimeout> | null = null;
    const handleError = (event: ErrorEvent) => {
      if (event.error?.message?.includes("Cannot read properties of undefined (reading 'count')")) {
        console.error("Globe rendering error — refreshing it", event);
        setErrorRefreshCount(e => e + 1);
        if (process.env.NODE_ENV === "development") {
          devLogTimer = setTimeout(() => {
            devLogTimer = null;
            // eslint-disable-next-line no-console
            console.warn("[globe] Rendering error was caught and the scene was remounted. TODO fix the underlying react-globe bug.");
          }, 1000);
        }
      }
    };
    window.addEventListener('error', handleError);
    return () => {
      window.removeEventListener('error', handleError);
      if (devLogTimer != null) {
        clearTimeout(devLogTimer);
      }
    };
  }, []);

  const tooltipRef = useRef<HTMLDivElement>(null);

  const [globeReady, setGlobeReady] = useState(false);

  // --- Satellites: cute 3D objects orbiting the globe. Positions are driven
  // directly in Three.js (not through react-globe.gl's `objectsData`) to avoid
  // the per-frame React re-renders that would otherwise cause, and the avatar
  // HTML overlay is positioned via `getScreenCoords` in the same rAF loop.
  const satelliteOverlayRef = useRef<HTMLDivElement>(null);
  type SatelliteDisplay = {
    country: { code: string, name: string },
    user: MetricsRecentUser | null,
  };
  const [satelliteDisplays, setSatelliteDisplays] = useState<Array<SatelliteDisplay | null>>(
    () => Array.from({ length: satelliteCount }, () => null),
  );
  // Refs to each satellite's avatar DOM node, registered by index.
  const avatarRefs = useRef<Array<HTMLDivElement | null>>([]);
  const setAvatarRef = (index: number) => (el: HTMLDivElement | null) => {
    avatarRefs.current[index] = el;
  };

  // Keep the latest per-country user pool in a ref so the satellite rAF loop
  // picks fresh data without re-binding (it would otherwise restart the
  // orbits every time the metrics refresh).
  const activeUsersByCountryRef = useRef(activeUsersByCountry);
  activeUsersByCountryRef.current = activeUsersByCountry;

  // --- Live user avatar layer: one ref per placement, populated via a
  // separate rAF loop that projects each avatar's lat/lng onto the canvas.
  const liveAvatarRefs = useRef<Array<HTMLDivElement | null>>([]);
  const setLiveAvatarRef = (index: number) => (el: HTMLDivElement | null) => {
    liveAvatarRefs.current[index] = el;
  };

  useEffect(() => {
    if (!globeReady || !mounted || satelliteCount <= 0) return;
    const globe = globeRef.current;
    if (!globe) return;

    const scene = globe.scene();
    const globeRadius = globe.getGlobeRadius();
    const orbitAltitude = 0.22; // in globe-radius units (matches react-globe.gl's altitude convention)
    const orbitRadius = globeRadius * (1 + orbitAltitude);
    const satelliteSize = globeRadius * 0.045;

    // Infer the globe's north-pole and prime-meridian axes via the globe's own
    // projection so the satellite orbits match lat/lng correctly regardless of
    // three-globe's internal orientation.
    const toVec3 = (c: { x: number, y: number, z: number }) => new Vector3(c.x, c.y, c.z);
    const northVec = toVec3(globe.getCoords(90, 0, 0)).normalize();
    const primeVec = toVec3(globe.getCoords(0, 0, 0)).normalize();

    const group = new Group();
    group.name = 'stack-auth-satellites';
    scene.add(group);

    const satellites: SatelliteHandle[] = [];
    for (let i = 0; i < satelliteCount; i++) {
      const mesh = createCuteSatelliteMesh(satelliteSize, theme);
      group.add(mesh);

      // Distribute inclinations and ascending nodes so multiple satellites
      // don't overlap paths. Alternate direction for visual interest.
      const inclination = (28 + i * 37) * (Math.PI / 180);
      const ascendingNode = (i * 118 + 40) * (Math.PI / 180);
      // ~130s per orbit on the primary satellite, slower on the second so
      // they visibly drift apart instead of moving in lockstep.
      const angularSpeed = (i % 2 === 0 ? 1 : -1) * (0.000027 - i * 0.000004);
      const phase = (i * Math.PI * 0.85);

      // Build an orthonormal orbit basis (right, up, normal).
      const orbitNormal = northVec.clone()
        .applyAxisAngle(primeVec, inclination)
        .applyAxisAngle(northVec, ascendingNode)
        .normalize();
      // Project primeVec onto the plane perpendicular to orbitNormal to get
      // the in-plane "right" reference direction.
      const orbitRight = primeVec.clone()
        .sub(orbitNormal.clone().multiplyScalar(primeVec.dot(orbitNormal)));
      // Fall back to a perpendicular axis if primeVec is (nearly) parallel to orbitNormal.
      if (orbitRight.lengthSq() < 1e-6) {
        orbitRight.copy(new Vector3(1, 0, 0)).sub(orbitNormal.clone().multiplyScalar(orbitNormal.x));
      }
      orbitRight.normalize();
      const orbitUp = orbitNormal.clone().cross(orbitRight).normalize();

      satellites.push({
        mesh,
        orbitNormal,
        orbitRight,
        orbitUp,
        orbitRadius,
        orbitAltitude,
        angularSpeed,
        phase,
        currentCountry: null,
        currentUser: null,
        lastCountryCheckAt: 0,
      });
    }

    const features = countries.features;
    let rafId: number | null = null;
    const tick = (time: number) => {
      const g = globeRef.current;
      if (!g) {
        rafId = requestAnimationFrame(tick);
        return;
      }

      // Keep the globe's render loop running while satellites are alive.
      if (resumeRenderIntervalRef.current !== null) {
        clearTimeout(resumeRenderIntervalRef.current);
        resumeRenderIntervalRef.current = null;
      }
      g.resumeAnimation();

      const camera = g.camera();
      const camDir = camera.position.clone().normalize();

      for (let i = 0; i < satellites.length; i++) {
        const sat = satellites[i] ?? throwErr(`missing satellite handle at index ${i}`);
        const angle = sat.phase + sat.angularSpeed * time;
        // Parametric circle in orbit plane: pos = R*(cos(a)*right + sin(a)*up).
        const pos = sat.orbitRight.clone().multiplyScalar(Math.cos(angle) * sat.orbitRadius)
          .add(sat.orbitUp.clone().multiplyScalar(Math.sin(angle) * sat.orbitRadius));
        sat.mesh.position.copy(pos);
        // Orient the satellite along its velocity vector (tangent to the orbit).
        const velocity = sat.orbitRight.clone().multiplyScalar(-Math.sin(angle))
          .add(sat.orbitUp.clone().multiplyScalar(Math.cos(angle)));
        sat.mesh.lookAt(pos.clone().add(velocity));

        // Positional data for country detection + avatar overlay.
        const geo = g.toGeoCoords({ x: pos.x, y: pos.y, z: pos.z });
        // Visibility: hide when on the far hemisphere (occluded by the globe).
        const satDir = pos.clone().normalize();
        const visible = satDir.dot(camDir) > 0.08;

        const avatarEl = avatarRefs.current[i];
        if (avatarEl) {
          if (visible) {
            const screen = g.getScreenCoords(geo.lat, geo.lng, geo.altitude);
            avatarEl.style.transform = `translate3d(${screen.x}px, ${screen.y}px, 0) translate(-50%, -140%)`;
            avatarEl.style.opacity = sat.currentCountry ? '1' : '0';
          } else {
            avatarEl.style.opacity = '0';
          }
        }

        // Country detection (throttled per satellite, 150ms).
        if (time - sat.lastCountryCheckAt > 150) {
          sat.lastCountryCheckAt = time;
          const found = findCountryAt(geo.lat, geo.lng, features);
          const prevCode = sat.currentCountry?.code ?? null;
          const nextCode = found?.code ?? null;
          if (prevCode !== nextCode) {
            sat.currentCountry = found;
            // Pick a random active user from that country for the bubble
            // avatar. Skip picking if none are available — the bubble then
            // just shows the country name/flag without a face.
            let nextUser: MetricsRecentUser | null = null;
            if (found) {
              const pool = activeUsersByCountryRef.current[found.code] ?? [];
              if (pool.length > 0) {
                nextUser = pool[Math.floor(Math.random() * pool.length)] ?? null;
              }
            }
            sat.currentUser = nextUser;
            setSatelliteDisplays((prev) => {
              const prevDisplay = prev[i] ?? null;
              if ((prevDisplay?.country.code ?? null) === nextCode
                && (prevDisplay?.user?.id ?? null) === (nextUser?.id ?? null)) {
                return prev;
              }
              const next = prev.slice();
              next[i] = found ? { country: found, user: nextUser } : null;
              return next;
            });
          }
        }
      }

      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      scene.remove(group);
      // Dispose geometries/materials to avoid GPU leaks on theme/remount.
      group.traverse((obj: any) => {
        if (obj.geometry) obj.geometry.dispose?.();
        const mat = obj.material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose?.());
        else mat?.dispose?.();
      });
    };
  }, [globeReady, mounted, satelliteCount, theme, countries]);

  // Keep satelliteDisplays length synced with satelliteCount (without
  // clobbering existing entries — handy for dev-time tweaks of the count).
  useEffect(() => {
    setSatelliteDisplays((prev) => {
      if (prev.length === satelliteCount) return prev;
      const next = prev.slice(0, satelliteCount);
      while (next.length < satelliteCount) next.push(null);
      return next;
    });
  }, [satelliteCount]);

  // --- Live-user avatar position loop: projects each placement's fixed
  // lat/lng onto the canvas every frame so the bubbles track the globe as
  // it rotates. Hides avatars on the far hemisphere. Also keeps the globe
  // animating so avatars stay in sync if satelliteCount is 0.
  useEffect(() => {
    if (!globeReady || !mounted || liveAvatars.length === 0) return;
    let rafId: number | null = null;
    const tick = () => {
      const g = globeRef.current;
      if (!g) {
        rafId = requestAnimationFrame(tick);
        return;
      }
      if (resumeRenderIntervalRef.current !== null) {
        clearTimeout(resumeRenderIntervalRef.current);
        resumeRenderIntervalRef.current = null;
      }
      g.resumeAnimation();
      const camDir = g.camera().position.clone().normalize();
      for (let i = 0; i < liveAvatars.length; i++) {
        const placement = liveAvatars[i] ?? throwErr(`live avatar placement ${i} missing`);
        const el = liveAvatarRefs.current[i];
        if (!el) continue;
        const cart = g.getCoords(placement.lat, placement.lng, 0);
        const dot = new Vector3(cart.x, cart.y, cart.z).normalize().dot(camDir);
        if (dot <= 0.05) {
          el.style.opacity = '0';
          continue;
        }
        const screen = g.getScreenCoords(placement.lat, placement.lng, 0);
        // Fade out near the silhouette edge for a smoother hand-off.
        const edgeFade = Math.min(1, (dot - 0.05) * 6);
        el.style.transform = `translate3d(${screen.x}px, ${screen.y}px, 0) translate(-50%, -50%)`;
        el.style.opacity = `${edgeFade}`;
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [globeReady, mounted, liveAvatars]);

  // set globeReady to true after a bit in case onGlobeReady was not called
  useEffect(() => {
    const timeout = setTimeout(() => {
      setGlobeReady(true);
    }, 5000);
    return () => clearTimeout(timeout);
  }, []);

  return (
    <div ref={rootRef} className='relative mx-auto' style={{ width: squareSize || '100%', height: squareSize || '100%' }}>
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
                    className='absolute rounded-full border-sky-300/40 dark:border-sky-300/40 border-slate-400/50 border border-solid'
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
                    className='absolute rounded-full border-sky-300/40 dark:border-sky-300/40 border-slate-400/50 border-2 border-solid blur-sm'
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
              className='relative w-full h-full cursor-grab active:cursor-grabbing [&_canvas]:!cursor-grab [&_canvas]:active:!cursor-grabbing'
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
                // Only clear when leaving the entire globe area
                setHexSelectedCountry(null);
                setPolygonSelectedCountry(null);
                if (globeRef.current) {
                  //globeRef.current.controls().autoRotate = true;
                }
              }}
              onTouchMove={resumeRender}
            >
              {/* Subtle glow effect */}
              <div className='absolute inset-0 bg-gradient-radial from-sky-500/15 via-sky-400/5 to-transparent dark:from-sky-400/12 dark:via-sky-500/5 blur-3xl opacity-40 pointer-events-none' />


              {mounted && isFastEngine !== null && (
                <div className='w-full h-full flex items-center justify-center'>
                  <Globe
                    key={`${errorRefreshCount}-${theme}`}
                    ref={globeRef}
                    backgroundColor='rgba(0,0,0,0)'
                    // globeImageUrl={globeImages[theme]}
                    globeMaterial={globeMaterial}
                    width={globeSize}
                    showGraticules={theme === 'dark'}
                    showAtmosphere={false}
                    height={globeSize}
                    onGlobeReady={() => {
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
                        // Little Saint James Island, U.S. Virgin Islands
                        current.pointOfView({ lat: 18.3076, lng: -64.8267 }, 0);

                        // Fix z-fighting: Enable proper depth testing
                        const renderer = current.renderer();
                        renderer.sortObjects = true;
                        // @ts-ignore - accessing internal context
                        const gl = renderer.getContext();
                        gl.enable(gl.DEPTH_TEST);
                        gl.depthFunc(gl.LEQUAL);

                        // Ensure all objects have proper depth settings and back-face culling
                        const scene = current.scene();
                        scene.traverse((object: any) => {
                          if (object.material) {
                            object.material.depthTest = true;
                            object.material.depthWrite = true;
                            // Only apply back-face culling to meshes (hexagons, globe), not lines (graticules)
                            if (object.isMesh) {
                              object.material.side = FrontSide;
                            }
                          }
                        });

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

                    polygonStrokeColor={() => theme === 'light' ? "rgba(0, 20, 40, 0.05)" : "rgba(255, 255, 255, 0.1)"}

                    polygonsData={countries.features}
                    polygonCapColor={() => "transparent"}
                    polygonSideColor={() => "transparent"}
                    polygonAltitude={0.001}
                    onPolygonHover={(d: any) => {
                      resumeRender();
                      // Polygons have no gaps, so use them for tooltip control
                      if (d) {
                        setPolygonSelectedCountry({ code: d.properties.ISO_A2_EH, name: d.properties.NAME });
                      } else {
                        // Clear immediately when hovering over ocean/non-land
                        setPolygonSelectedCountry(null);
                      }
                    }}

                    hexPolygonsData={countries.features}
                    hexPolygonResolution={3}
                    hexPolygonMargin={0.6}
                    hexPolygonAltitude={(d: any) => {
                      const highlight = isFastEngine && d.properties.ISO_A2_EH === selectedCountryRef.current?.code;
                      return highlight ? 0.01 : 0.002;
                    }}
                    hexPolygonColor={(country: any) => {
                      const highlight = isFastEngine && country.properties.ISO_A2_EH === selectedCountryRef.current?.code;
                      const value = colorValues.get(country.properties.ISO_A2_EH) ?? null;

                      if (highlight) return theme === 'dark' ? "#e0f2fe" : "#0c4a6e";

                      // Base color for countries with no users - theme-aware
                      if (Number.isNaN(value) || value === null || maxColorValue < 0.0001) {
                        // Dark mode: light slate, Light mode: darker slate for visibility
                        return theme === 'dark' ? "#4d535c" : "#d4d4d4";
                      }

                      const linear = Math.min(1, value / maxColorValue);
                      // Gamma > 1 pulls mid values apart (more contrast between similar counts)
                      const scaled = Math.pow(linear, 1.18);
                      if (theme === 'dark') {
                        const h = 220 + 20 * scaled;
                        const s = 50 + 50 * scaled;
                        const l = 100 - 40 * scaled;
                        return `hsl(${h}, ${s}%, ${l}%)`;
                      }
                      const h = 200 + 40 * scaled;
                      const s = 50 + 50 * scaled;
                      const l = 90 - 40 * scaled;
                      return `hsl(${h}, ${s}%, ${l}%)`;
                    }}
                    onHexPolygonHover={(p: any) => {
                      resumeRender();
                      // Mirror the polygon hover handler: hexes render on top of
                      // polygons so pointer motion alternates between the two —
                      // both must write to the same `polygonSelectedCountry`
                      // state or the tooltip flickers as the pointer travels
                      // hex → polygon → hex.
                      if (p) {
                        setPolygonSelectedCountry({ code: p.properties.ISO_A2_EH, name: p.properties.NAME });
                      } else {
                        // Clear immediately when hovering over ocean/non-land
                        setPolygonSelectedCountry(null);
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

              {/* Live-user avatar layer: real profile images keyed by country,
                  sized and counted based on the country's visible area on
                  the globe. Each avatar has a layered `animate-ping` ring so
                  it reads as a live "presence beacon". Positions are tracked
                  by the live-avatar rAF effect. */}
              <div
                className='absolute inset-0 pointer-events-none overflow-hidden'
                aria-hidden="true"
              >
                {liveAvatars.map((placement, i) => (
                  <div
                    key={placement.key}
                    ref={setLiveAvatarRef(i)}
                    className='absolute top-0 left-0 opacity-0 will-change-transform'
                    style={{
                      width: `${placement.size}px`,
                      height: `${placement.size}px`,
                      transform: 'translate3d(0px, 0px, 0) translate(-50%, -50%)',
                      transition: 'opacity 200ms ease-out',
                    }}
                  >
                    {/* Growing ring pings — staggered so neighboring avatars
                        don't pulse in unison. */}
                    <div
                      className='absolute inset-0 rounded-full bg-emerald-400/40 dark:bg-emerald-300/45'
                      style={{
                        animation: 'ping 2s cubic-bezier(0, 0, 0.2, 1) infinite',
                        animationDelay: `${placement.ringDelayMs}ms`,
                      }}
                    />
                    <div
                      className='absolute inset-0 rounded-full bg-emerald-400/20 dark:bg-emerald-300/25'
                      style={{
                        animation: 'ping 2s cubic-bezier(0, 0, 0.2, 1) infinite',
                        animationDelay: `${placement.ringDelayMs + 700}ms`,
                      }}
                    />
                    {/* Avatar core — real user profile image, falling back to
                        initials via UserAvatar's AvatarFallback. */}
                    <div className='relative w-full h-full rounded-full overflow-hidden ring-2 ring-emerald-400/90 dark:ring-emerald-300/90 shadow-[0_2px_8px_rgba(16,185,129,0.45)]'>
                      <UserAvatar
                        size={placement.size}
                        user={{
                          profileImageUrl: placement.user.profile_image_url,
                          displayName: placement.user.display_name,
                          primaryEmail: placement.user.primary_email,
                        }}
                      />
                    </div>
                    {/* Tiny solid "heart" dot as a secondary "live" signal. */}
                    <div className='absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 dark:bg-emerald-300 ring-2 ring-background shadow' />
                  </div>
                ))}
              </div>

              {/* Satellite bubbles — transformed each frame by the satellite
                  rAF loop so they track the orbiting meshes and fade in when
                  over a country. Show a real user's avatar from that country
                  when one is available. */}
              <div
                ref={satelliteOverlayRef}
                className='absolute inset-0 pointer-events-none overflow-hidden'
                aria-hidden="true"
              >
                {satelliteDisplays.map((display, i) => (
                  <div
                    key={i}
                    ref={setAvatarRef(i)}
                    className='absolute top-0 left-0 opacity-0 transition-opacity duration-300 ease-out will-change-transform'
                    style={{ transform: 'translate3d(0px, 0px, 0) translate(-50%, -140%)' }}
                  >
                    <div className='flex flex-col items-center gap-1.5'>
                      <div className='flex items-center gap-1.5 px-2 py-1 rounded-full bg-background/95 ring-1 ring-foreground/10 shadow-lg backdrop-blur-md'>
                        {display?.user && (
                          <div className='w-7 h-7 rounded-full overflow-hidden ring-2 ring-sky-400/60 dark:ring-sky-300/50'>
                            <UserAvatar
                              size={28}
                              user={{
                                profileImageUrl: display.user.profile_image_url,
                                displayName: display.user.display_name,
                                primaryEmail: display.user.primary_email,
                              }}
                            />
                          </div>
                        )}
                        <div className='flex items-center gap-1 pr-1.5'>
                          <span className='text-sm leading-none'>
                            {display?.country.code.match(/^[a-zA-Z][a-zA-Z]$/) ? getFlagEmoji(display.country.code) : '🌍'}
                          </span>
                          <span className='text-[10px] font-medium text-foreground/80 max-w-[90px] truncate'>
                            {display?.country.name ?? ''}
                          </span>
                        </div>
                      </div>
                      {/* Little thread connecting the bubble down to the satellite. */}
                      <div className='w-px h-3 bg-gradient-to-b from-sky-400/60 to-transparent dark:from-sky-300/60' />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
      {/* Tooltip — portal to body so card's backdrop-filter/overflow-hidden
          doesn't create a containing block that clips it */}
      {mounted && lastSelectedCountry && createPortal(
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
        </div>,
        document.body
      )}
    </div>
  );
}
