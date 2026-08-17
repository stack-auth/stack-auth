import { headers } from "next/headers";
import { NextResponse } from "next/server";

/**
 * Returns the dashboard viewer's approximate latitude and longitude,
 * derived from IP-based geolocation headers injected by the CDN/proxy
 * (Vercel, Cloudflare). No browser permissions are required.
 *
 * Returns `{ lat, lng }` when geo headers are available, otherwise
 * `{ lat: null, lng: null }` so the caller can fall back.
 */
export async function GET() {
  const allHeaders = await headers();

  // Vercel injects lat/lng headers on every edge/serverless request.
  const vercelLat = allHeaders.get("x-vercel-ip-latitude");
  const vercelLng = allHeaders.get("x-vercel-ip-longitude");

  if (vercelLat != null && vercelLng != null) {
    const lat = parseFloat(vercelLat);
    const lng = parseFloat(vercelLng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return NextResponse.json({ lat, lng });
    }
  }

  // Cloudflare provides a cf-ipcountry header but no lat/lng, so we can't
  // do much with it here. Fall back gracefully.

  return NextResponse.json({ lat: null, lng: null });
}
