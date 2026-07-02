"use client";

import { captureError } from "@hexclave/shared/dist/utils/errors";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { useEffect, useState } from "react";

type ViewerLocation = { lat: number, lng: number };

// US geographic center fallback
export const US_CENTER: ViewerLocation = { lat: 39.5, lng: -98.35 };

// Cache the result so we only fetch once per page load, even if multiple
// components mount/unmount the hook.
let cachedLocation: ViewerLocation | null = null;
let fetchPromise: Promise<ViewerLocation> | null = null;

function fetchViewerLocation(): Promise<ViewerLocation> {
  if (fetchPromise != null) return fetchPromise;
  fetchPromise = (async () => {
    try {
      const res = await fetch("/api/viewer-location");
      if (!res.ok) { fetchPromise = null; return US_CENTER; }
      const data = await res.json();
      if (typeof data.lat === "number" && typeof data.lng === "number") {
        return { lat: data.lat, lng: data.lng };
      }
    } catch (e) {
      captureError("viewer-location-fetch", e instanceof Error ? e : new Error(String(e)));
      fetchPromise = null;
    }
    // Header data was missing or malformed; allow retry on next mount.
    fetchPromise = null;
    return US_CENTER;
  })();
  return fetchPromise;
}

/**
 * Returns the dashboard viewer's approximate location based on IP
 * geolocation (via CDN headers), falling back to the US center.
 * The fetch runs once per page load and the result is cached.
 */
export function useViewerLocation(): ViewerLocation {
  const [location, setLocation] = useState<ViewerLocation>(() => cachedLocation ?? US_CENTER);

  useEffect(() => {
    if (cachedLocation != null) return;
    let cancelled = false;
    runAsynchronously(async () => {
      const loc = await fetchViewerLocation();
      // Only cache a successful (non-fallback) result so transient
      // failures can be retried on next mount.
      if (loc !== US_CENTER) {
        cachedLocation = loc;
      }
      if (!cancelled) setLocation(loc);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return location;
}
