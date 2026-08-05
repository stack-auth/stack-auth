/**
 * Minimal user-agent describer for admin surfaces (session replays, activity
 * lists). We deliberately don't pull in a UA-parsing dependency: we only need a
 * human-readable "Chrome 141 on macOS" summary, and every UA we see is one the
 * event tracker collected from `navigator.userAgent` in a real browser.
 *
 * The rules are ordered because UA strings lie for backwards-compatibility
 * reasons: Edge claims to be Chrome and Safari, Chrome claims to be Safari, and
 * every iOS browser claims to be Safari. Matching the most specific token first
 * is the only way to get the right answer.
 */

export type UserAgentDeviceType = "desktop" | "mobile" | "tablet" | "bot";

export type DescribedUserAgent = {
  deviceType: UserAgentDeviceType,
  /** Browser name plus major version, eg. `Chrome 141`. Null when unrecognized. */
  browser: string | null,
  /** OS name plus version where the UA reports a meaningful one, eg. `iOS 17.2`. Null when unrecognized. */
  os: string | null,
};

const BOT_REGEX = /bot\b|crawler|spider|crawling|slurp|headlesschrome|lighthouse|bingpreview|facebookexternalhit|pingdom|curl\/|wget\/|python-requests/i;

// Ordered: the first rule that matches wins.
const BROWSER_RULES: Array<{ name: string, regex: RegExp }> = [
  { name: "Edge", regex: /\bEdg(?:e|A|iOS)?\/([\d.]+)/ },
  { name: "Opera", regex: /\bOPR\/([\d.]+)/ },
  { name: "Opera", regex: /\bOpera\/([\d.]+)/ },
  { name: "Samsung Internet", regex: /\bSamsungBrowser\/([\d.]+)/ },
  { name: "Brave", regex: /\bBrave\/([\d.]+)/ },
  { name: "Vivaldi", regex: /\bVivaldi\/([\d.]+)/ },
  { name: "Firefox", regex: /\b(?:Firefox|FxiOS)\/([\d.]+)/ },
  // `HeadlessChrome` has no word boundary before `Chrome`, so it needs naming
  // explicitly; it still gets classified as a bot separately.
  { name: "Chrome", regex: /\b(?:HeadlessChrome|Chrome|CriOS|Chromium)\/([\d.]+)/ },
  // Safari puts the user-facing version in `Version/`; the `Safari/` token is a
  // WebKit build number and useless as a version.
  { name: "Safari", regex: /\bVersion\/([\d.]+).*\bSafari\// },
  { name: "Internet Explorer", regex: /\bTrident\/.*\brv:([\d.]+)/ },
  { name: "Internet Explorer", regex: /\bMSIE ([\d.]+)/ },
];

// A Map rather than a Record so unlisted NT versions (older or newer than the
// ones we name) are typed as absent and fall back to a plain "Windows".
const WINDOWS_NT_VERSIONS = new Map<string, string>([
  ["10.0", "Windows 10+"],
  ["6.3", "Windows 8.1"],
  ["6.2", "Windows 8"],
  ["6.1", "Windows 7"],
]);

function majorVersion(version: string): string {
  return version.split(".")[0] ?? version;
}

function describeBrowser(userAgent: string): string | null {
  for (const rule of BROWSER_RULES) {
    const match = rule.regex.exec(userAgent);
    if (match?.[1] != null) {
      return `${rule.name} ${majorVersion(match[1])}`;
    }
  }
  return null;
}

function describeOs(userAgent: string): string | null {
  const windows = /Windows NT ([\d.]+)/.exec(userAgent);
  if (windows?.[1] != null) {
    return WINDOWS_NT_VERSIONS.get(windows[1]) ?? "Windows";
  }

  // iPadOS/iOS report the version with underscores, and iPad Safari in desktop
  // mode reports `Macintosh` — that ambiguity is unresolvable from the UA, so
  // such a request is described as macOS.
  const ios = /(?:iPhone OS|CPU OS|iPhone_OS) ([\d_]+)/.exec(userAgent);
  if (ios?.[1] != null) {
    return `iOS ${ios[1].replaceAll("_", ".")}`;
  }
  if (/\biPad\b|\biPhone\b|\biPod\b/.test(userAgent)) {
    return "iOS";
  }

  const android = /Android ([\d.]+)/.exec(userAgent);
  if (android?.[1] != null) {
    return `Android ${majorVersion(android[1])}`;
  }
  if (/\bAndroid\b/.test(userAgent)) {
    return "Android";
  }

  if (/\bCrOS\b/.test(userAgent)) return "ChromeOS";
  // The reported `Mac OS X 10_15_7` has been frozen by browsers for years, so
  // showing it would be actively misleading.
  if (/\bMac OS X\b|\bMacintosh\b/.test(userAgent)) return "macOS";
  if (/\bWindows\b/.test(userAgent)) return "Windows";
  if (/\bUbuntu\b/.test(userAgent)) return "Ubuntu";
  if (/\bLinux\b|\bX11\b/.test(userAgent)) return "Linux";
  return null;
}

function describeDeviceType(userAgent: string): UserAgentDeviceType {
  if (BOT_REGEX.test(userAgent)) return "bot";
  // Android tablets are Android UAs *without* the `Mobile` token.
  if (/\biPad\b|\bTablet\b|\bSilk\b|\bPlayBook\b/.test(userAgent)) return "tablet";
  if (/\bAndroid\b/.test(userAgent) && !/\bMobile\b/.test(userAgent)) return "tablet";
  if (/\bMobi\b|\bMobile\b|\biPhone\b|\biPod\b|\bAndroid\b|\bWindows Phone\b/.test(userAgent)) return "mobile";
  return "desktop";
}

export function describeUserAgent(userAgent: string): DescribedUserAgent {
  return {
    deviceType: describeDeviceType(userAgent),
    browser: describeBrowser(userAgent),
    os: describeOs(userAgent),
  };
}

/** `Chrome 141 on macOS`, degrading gracefully when either half is unknown. */
export function formatUserAgentSummary(userAgent: string): string | null {
  const described = describeUserAgent(userAgent);
  if (described.browser != null && described.os != null) return `${described.browser} on ${described.os}`;
  return described.browser ?? described.os;
}
