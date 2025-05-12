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
 * Tries to guess the end user's IP address based on the current request's headers. Returns `undefined` if the end
 * user IP can't be determined.
 *
 * This value can be spoofed by any user to any value; do not trust the value for security purposes (use the
 * `getExactEndUserIp` function for that). It is useful for derived data like location analytics, which can be spoofed
 * with VPNs anyways. However, for legitimate users, this function is guaranteed to either return the IP address
 * (potentially of a VPN/proxy) or `undefined`.
 *
 * Note that the "end user" refers to the user sitting behind a computer screen; for example, if my-stack-app.com is
 * using Stack Auth, and person A is on my-stack-app.com and sends a server action to server B of my-stack-app.com,
 * then the end user IP address is the address of the computer of person A, not server B.
 *
 * If we can determine that the request is coming from a browser, we try to read the IP address from the proxy headers.
 * Otherwise, we can read the `X-Stack-Requester` header to find information about the end user's IP address. (We don't
 * do this currently, see the TODO in the implementation.)
 */
export async function getSpoofableEndUserIp(): Promise<string | undefined> {
  const endUserInfo = await getEndUserInfo();
  return endUserInfo?.maybeSpoofed ? endUserInfo.spoofedInfo.ip : endUserInfo?.exactInfo.ip;
}


/**
 * Tries to guess the end user's IP address based on the current request's headers. If
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
  return endUserInfo?.maybeSpoofed === false ? pick(endUserInfo.exactInfo, ["countryCode", "regionCode", "cityName", "latitude", "longitude", "tzIdentifier"]) : null;
}


type EndUserInfoInner = EndUserLocation & { ip: string }

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
    // this case is easy, we just read the IP from the headers
    const ip =
      allHeaders.get("cf-connecting-ip")
      ?? allHeaders.get("x-vercel-forwarded-for")
      ?? allHeaders.get("x-real-ip")
      ?? allHeaders.get("x-forwarded-for")?.split(",").at(0)
      ?? undefined;
    if (!ip || !isIpAddress(ip)) {
      console.warn("getEndUserIp() found IP address in headers, but is invalid. This is most likely a misconfigured client", { ip, headers: Object.fromEntries(allHeaders) });
      return null;
    }

    return ip ? {
      // currently we just trust all headers (including X-Forwarded-For), so this is easy to spoof
      // hence, we set maybeSpoofed to true
      // TODO be smarter about this (eg. use x-vercel-signature and CF request validation to make sure they pass through
      // those proxies before trusting the values)
      maybeSpoofed: true,

      spoofedInfo: {
        ip,

        // TODO use our own geoip data so we can get better accuracy, and also support non-Vercel/Cloudflare setups
        countryCode: (allHeaders.get("cf-ipcountry") ?? allHeaders.get("x-vercel-ip-country")) || undefined,
        regionCode: allHeaders.get("x-vercel-ip-country-region") || undefined,
        cityName: allHeaders.get("x-vercel-ip-city") || undefined,
        latitude: allHeaders.get("x-vercel-ip-latitude") ? parseFloat(allHeaders.get("x-vercel-ip-latitude")!) : undefined,
        longitude: allHeaders.get("x-vercel-ip-longitude") ? parseFloat(allHeaders.get("x-vercel-ip-longitude")!) : undefined,
        tzIdentifier: allHeaders.get("x-vercel-ip-timezone") || undefined,
      },
    } : null;
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
