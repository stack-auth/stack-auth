import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { isIpAddress } from "@stackframe/stack-shared/dist/utils/ips";
import { pick } from "@stackframe/stack-shared/dist/utils/objects";
import { headers } from "next/headers";

// An end user is a person sitting behind a computer screen.
//
// For example, if my-stack-app.com is using Stack Auth, and person A is on my-stack-app.com and sends a server action
// to server B of my-stack-app.com, then the end user is person A, not server B.
//
// An end user is not the same as a ProjectUser. For example, if person A is not logged into
// my-stack-app.com, they are still considered an end user, and will have an associated IP address.


/**
 * Returns the end user's IP address from the current request's headers, or `undefined` if it can't be determined.
 * Falls back to spoofable headers (x-forwarded-for) if no trusted proxy header (cf-connecting-ip,
 * x-vercel-forwarded-for) is available.
 */
export async function getSpoofableEndUserIp(): Promise<string | undefined> {
  const endUserInfo = await getEndUserInfo();
  return endUserInfo?.maybeSpoofed ? endUserInfo.spoofedInfo.ip : endUserInfo?.exactInfo.ip;
}


/**
 * Returns the end user's IP only if it came from a trusted proxy header (cf-connecting-ip or x-vercel-forwarded-for).
 * Returns `undefined` if the IP could only be determined from spoofable headers.
 */
export async function getExactEndUserIp(): Promise<string | undefined> {
  const endUserInfo = await getEndUserInfo();
  return endUserInfo?.maybeSpoofed ? undefined : endUserInfo?.exactInfo.ip;
}

type EndUserLocation = {
  countryCode?: string,
  regionCode?: string,
  cityName?: string,
  latitude?: number,
  longitude?: number,
  tzIdentifier?: string,
};

export async function getSpoofableEndUserLocation(): Promise<EndUserLocation | null> {
  const endUserInfo = await getEndUserInfo();
  if (!endUserInfo) {
    return null;
  }

  const locationInfo = getLocationInfo(endUserInfo);
  return pick(locationInfo, ["countryCode", "regionCode", "cityName", "latitude", "longitude", "tzIdentifier"]);
}

export type BestEffortEndUserRequestContext = {
  ipAddress: string | null,
  ipTrusted: boolean | null,
  location: EndUserLocation | null,
};

export async function getBestEffortEndUserRequestContext(): Promise<BestEffortEndUserRequestContext> {
  const endUserInfo = await getEndUserInfo();
  if (!endUserInfo) {
    return {
      ipAddress: null,
      ipTrusted: null,
      location: null,
    };
  }

  const locationInfo = getLocationInfo(endUserInfo);
  return {
    ipAddress: locationInfo.ip,
    ipTrusted: !endUserInfo.maybeSpoofed,
    location: pick(locationInfo, ["countryCode", "regionCode", "cityName", "latitude", "longitude", "tzIdentifier"]),
  };
}


type EndUserInfoInner = EndUserLocation & { ip: string }

function getLocationInfo(endUserInfo: { maybeSpoofed: true, spoofedInfo: EndUserInfoInner } | { maybeSpoofed: false, exactInfo: EndUserInfoInner }) {
  return endUserInfo.maybeSpoofed ? endUserInfo.spoofedInfo : endUserInfo.exactInfo;
}

export async function getEndUserInfo(): Promise<
  // discriminated union to make sure the user is really explicit about checking the maybeSpoofed field
  | { maybeSpoofed: true, spoofedInfo: EndUserInfoInner }
  | { maybeSpoofed: false, exactInfo: EndUserInfoInner }
  | null
> {
  const allHeaders = await headers();

  // note that this is just the requester claiming to be a browser; we can't trust them as they could just fake the
  // headers
  //
  // but in this case, there's no reason why an attacker would want to fake it
  //
  // this works for all modern browsers because Mozilla is part of the user agent of all of them
  // https://stackoverflow.com/a/1114297
  const isClaimingToBeBrowser = ["Mozilla", "Chrome", "Safari"].some(header => allHeaders.get("User-Agent")?.includes(header));

  if (isClaimingToBeBrowser) {
    // cf-connecting-ip and x-vercel-forwarded-for are set by the proxy (Cloudflare/Vercel) based on the actual TCP
    // connection — they cannot be spoofed by the client as long as the origin is only reachable through the proxy,
    // which is the case for Vercel deployments.
    const trustedIp = allHeaders.get("x-vercel-forwarded-for") ?? allHeaders.get("cf-connecting-ip") ?? undefined;
    const spoofableIp = allHeaders.get("x-real-ip") ?? allHeaders.get("x-forwarded-for")?.split(",").at(0) ?? undefined;
    const ip = trustedIp ?? spoofableIp;

    if (!ip || !isIpAddress(ip)) {
      console.warn("getEndUserIp() found IP address in headers, but is invalid. This is most likely a misconfigured client", { ip, headers: Object.fromEntries(allHeaders) });
      return null;
    }

    // TODO use our own geoip data so we can get better accuracy, and also support non-Vercel/Cloudflare setups
    const location: EndUserLocation = {
      countryCode: (allHeaders.get("x-vercel-ip-country") ?? allHeaders.get("cf-ipcountry")) || undefined,
      regionCode: allHeaders.get("x-vercel-ip-country-region") || undefined,
      cityName: allHeaders.get("x-vercel-ip-city") || undefined,
      latitude: allHeaders.get("x-vercel-ip-latitude") ? parseFloat(allHeaders.get("x-vercel-ip-latitude")!) : undefined,
      longitude: allHeaders.get("x-vercel-ip-longitude") ? parseFloat(allHeaders.get("x-vercel-ip-longitude")!) : undefined,
      tzIdentifier: allHeaders.get("x-vercel-ip-timezone") || undefined,
    };

    if (trustedIp) {
      return { maybeSpoofed: false, exactInfo: { ip, ...location } };
    }
    return { maybeSpoofed: true, spoofedInfo: { ip, ...location } };
  }

  /**
   * Specifies whether this request is coming from a trusted server (ie. a server with a valid secret server key).
   *
   * If a trusted server gives us an end user IP, then we always trust them.
   *
   * TODO we don't currently check if the server is trusted, and always assume false. fix that
   */
  const isTrustedServer = false as boolean;

  if (isTrustedServer) {
    // TODO we currently don't do anything to find the IP address if the request is coming from a trusted server, so
    // this is never set to true
    // we should fix that, by storing IP information in X-Stack-Requester in the StackApp interface on servers, and then
    // reading that information
    throw new StackAssertionError("getEndUserIp() is unimplemented for trusted servers");
  }

  // we don't know anything about this request
  // most likely it's a consumer of our REST API that doesn't use our SDKs
  return null;
}
