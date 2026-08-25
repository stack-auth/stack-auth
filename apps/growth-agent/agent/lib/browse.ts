import { runAgentBrowserCommand, withAgentBrowserSandbox } from "@agent-browser/sandbox/vercel";
import type { NetworkPolicy } from "@vercel/sandbox";
import type { SandboxSession } from "eve/sandbox";

/**
 * Renders a page in a real (headless Chromium) browser inside an ephemeral,
 * credential-free Vercel Sandbox microVM and returns the page's accessibility
 * snapshot, so the model can research JS-heavy sites that raw `curl` cannot.
 *
 * This deliberately runs as an app-side tool (in the growth-agent runtime, via
 * `@agent-browser/sandbox`) rather than inside eve's own managed subagent
 * sandbox: the eve sandbox only exposes bash/curl, and provisioning Chromium
 * there would couple the browsing stack to eve's sandbox lifecycle. The
 * microVM created here is separate, holds no secrets (we never pass env into
 * it; the Vercel credentials below only authenticate the *creation* API call
 * from the app runtime and are not injected into the VM), and is stopped in
 * the helper's `finally` plus server-side auto-terminated via `timeout`.
 */

export type BrowsePageResult = {
  readonly finalUrl: string,
  readonly title: string,
  /** Interactive-compact accessibility snapshot, capped at {@link SNAPSHOT_CHAR_CAP} chars. */
  readonly snapshotText: string,
  readonly screenshotBase64?: string,
};

const SNAPSHOT_CHAR_CAP = 20_000;
const CURL_FALLBACK_BODY_BYTE_CAP = 2_000_000;

// Wall-time caps, enforced server-side by the sandbox `timeout` option (the VM
// auto-terminates even if this process dies mid-call). With a pre-built
// AGENT_BROWSER_SNAPSHOT_ID the sandbox boots in under a second, so 60s is
// plenty for open + snapshot; without one the helper cold-installs Chromium
// (~30s) first, so we allow extra headroom rather than making every cold call
// fail. Configure a snapshot id in production to get the tight cap.
const SANDBOX_TIMEOUT_WITH_SNAPSHOT_MS = 60_000;
const SANDBOX_TIMEOUT_COLD_BOOT_MS = 120_000;

// Same IPv4 denylist as agent/subagents/website-research/sandbox.ts (see the
// rationale there): the browser fetches arbitrary customer-supplied URLs, so
// egress to loopback, RFC1918, link-local, CGNAT, and "this network" ranges is
// blocked at the microVM firewall. This catches what the pre-flight URL check
// in validateBrowseUrl cannot: hostnames that *resolve* to private IPs and
// redirects into private space.
const PRIVATE_SUBNET_DENYLIST = [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.168.0.0/16",
];

const BROWSE_NETWORK_POLICY: NetworkPolicy = {
  allow: { "*": [] },
  subnets: { deny: PRIVATE_SUBNET_DENYLIST },
};

/**
 * Whether the runtime is configured to create Vercel Sandboxes. Local
 * development must expose an explicit token because it has no Vercel request
 * context. A deployed Vercel Function is different: Vercel supplies OIDC in
 * the request context, so the Sandbox SDK—not this environment-only probe—must
 * perform the credential check there.
 */
export function isBrowseSandboxAvailable(): boolean {
  const env = process.env;
  // The browser helper is a Vercel Sandbox even when the Growth agent itself is
  // running locally. Respect the explicit backend pin before falling back to the
  // deployment probe; otherwise local dev can route Eve's sandboxes to Vercel
  // while this helper incorrectly disables the browser and forces curl.
  const configuredBackend = env.HEXCLAVE_GROWTH_SANDBOX_BACKEND;
  const backend = configuredBackend != null && configuredBackend.length > 0
    ? configuredBackend
    : env.VERCEL != null && env.VERCEL.length > 0 ? "vercel" : "docker";
  if (backend !== "vercel") return false;
  // In a deployed Vercel Function, the OIDC token is available to the SDK via
  // the incoming request context rather than process.env. Do not reject the
  // call before withAgentBrowserSandbox() can use that runtime credential.
  if (env.VERCEL != null && env.VERCEL.length > 0) return true;
  const hasTokenTriple = [env.VERCEL_TOKEN, env.VERCEL_TEAM_ID, env.VERCEL_PROJECT_ID]
    .every((value) => value != null && value.length > 0);
  const hasOidcToken = env.VERCEL_OIDC_TOKEN != null && env.VERCEL_OIDC_TOKEN.length > 0;
  return hasTokenTriple || hasOidcToken;
}

function isCurlFallbackSandboxSafe(): boolean {
  const configuredBackend = process.env.HEXCLAVE_GROWTH_SANDBOX_BACKEND;
  const backend = configuredBackend != null && configuredBackend.length > 0
    ? configuredBackend
    : process.env.VERCEL != null && process.env.VERCEL.length > 0 ? "vercel" : "docker";
  // The website-research Vercel sandbox has a subnet denylist that applies to
  // DNS results and redirects. Its local Docker backend is allow-all, so the
  // literal-IP URL preflight alone is not enough to safely curl an untrusted
  // hostname there.
  return backend === "vercel";
}

type CurlFallbackSandbox = Pick<SandboxSession, "readBinaryFile" | "removePath" | "run">;

function decodeHtmlEntities(value: string): string {
  const namedEntities = new Map([
    ["amp", "&"],
    ["apos", "'"],
    ["gt", ">"],
    ["lt", "<"],
    ["nbsp", " "],
    ["quot", "\""],
  ]);
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entityText, entityName: string) => {
    if (entityName.startsWith("#x")) {
      const codePoint = Number.parseInt(entityName.slice(2), 16);
      return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10FFFF ? String.fromCodePoint(codePoint) : entityText;
    }
    if (entityName.startsWith("#")) {
      const codePoint = Number.parseInt(entityName.slice(1), 10);
      return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10FFFF ? String.fromCodePoint(codePoint) : entityText;
    }
    return namedEntities.get(entityName.toLowerCase()) ?? entityText;
  });
}

/**
 * Turns a curl-fetched HTML document into a compact, model-readable fallback.
 * This is deliberately not presented as a rendered browser snapshot: scripts
 * and styles are removed, block boundaries become newlines, and the result is
 * labelled so the researcher knows client-rendered content may be missing.
 */
export function extractCurlFallbackPage(html: string, requestedUrl: string, finalUrl: string): BrowsePageResult {
  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = decodeHtmlEntities(titleMatch?.[1]?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() ?? "");
  const visibleText = decodeHtmlEntities(html
    .replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, " ")
    .replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--([\s\S]*?)-->/g, " ")
    .replace(/<\/(?:article|aside|blockquote|div|footer|form|h[1-6]|header|li|main|nav|ol|p|section|table|tr|ul)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n");
  const fallbackNotice = `[curl fallback: Chromium was unavailable; this is static HTML from ${requestedUrl} and may omit client-rendered content.]`;
  const fullSnapshot = `${fallbackNotice}\n${visibleText}`;
  const snapshotText = fullSnapshot.length > SNAPSHOT_CHAR_CAP
    ? `${fullSnapshot.slice(0, SNAPSHOT_CHAR_CAP)}\n… [snapshot truncated at ${SNAPSHOT_CHAR_CAP} characters]`
    : fullSnapshot;
  return { finalUrl, title, snapshotText };
}

/**
 * Fetches a public page through the website-research subagent's SSRF-hardened
 * Eve sandbox. The URL is passed through the process environment instead of
 * interpolated into the shell command, so arbitrary URL characters cannot
 * become shell syntax. This is the automatic fallback when the separate
 * Chromium sandbox cannot be created.
 */
export async function fetchPageWithCurl(options: {
  readonly url: string,
  readonly requestId: string,
  readonly sandbox: CurlFallbackSandbox,
}): Promise<BrowsePageResult> {
  const validatedUrl = validateBrowseUrl(options.url);
  const safeRequestId = options.requestId.replace(/[^A-Za-z0-9_-]/g, "_");
  const outputPath = `/workspace/browse-page-${safeRequestId}.untracked.html`;
  try {
    const result = await options.sandbox.run({
      command: "curl --silent --show-error --location --compressed --fail-with-body --max-time 30 --max-filesize 2000000 --output \"$HEXCLAVE_BROWSE_OUTPUT_PATH\" --write-out '%{url_effective}' -- \"$HEXCLAVE_BROWSE_URL\"",
      env: {
        HEXCLAVE_BROWSE_OUTPUT_PATH: outputPath,
        HEXCLAVE_BROWSE_URL: validatedUrl.toString(),
      },
    });
    if (result.exitCode !== 0) {
      throw new Error(`curl fallback failed with exit code ${result.exitCode}: ${result.stderr.trim() || "no error detail"}`);
    }
    const body = await options.sandbox.readBinaryFile({ path: outputPath });
    if (body == null) throw new Error("curl fallback completed without producing a response body.");
    const html = new TextDecoder().decode(body.slice(0, CURL_FALLBACK_BODY_BYTE_CAP));
    const finalUrl = result.stdout.trim() || validatedUrl.toString();
    return extractCurlFallbackPage(html, validatedUrl.toString(), finalUrl);
  } finally {
    await options.sandbox.removePath({ path: outputPath, force: true, recursive: false });
  }
}

/** Only credential/setup failures should switch rendering engines. Navigation
 * and page errors still surface normally so a broken target is not mistaken
 * for a successful static fetch. */
export function isBrowserSandboxCredentialError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "VercelOidcContextError"
    || error.name === "LocalOidcContextError"
    || /Could not get credentials from OIDC context|Missing credentials parameters to access the Vercel API|Browser sandbox is unavailable outside a Vercel deployment or its credentials are missing/.test(error.message);
}

export async function browsePageWithCurlFallback(options: {
  readonly url: string,
  readonly requestId: string,
  readonly getSandbox: () => Promise<CurlFallbackSandbox>,
}): Promise<BrowsePageResult> {
  const curlFallback = async (): Promise<BrowsePageResult> => await fetchPageWithCurl({
    url: options.url,
    requestId: options.requestId,
    sandbox: await options.getSandbox(),
  });
  if (!isBrowseSandboxAvailable()) {
    if (!isCurlFallbackSandboxSafe()) {
      throw new Error(
        "Browser sandbox is unavailable and the current Eve sandbox does not enforce the subnet firewall required for a safe curl fallback.",
      );
    }
    return await curlFallback();
  }
  try {
    return await browsePage({ url: options.url, screenshot: false });
  } catch (error) {
    if (!isBrowserSandboxCredentialError(error)) throw error;
    if (!isCurlFallbackSandboxSafe()) throw error;
    return await curlFallback();
  }
}

class BrowseUrlValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrowseUrlValidationError";
  }
}

function parseIpv4(hostname: string): readonly number[] | undefined {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (match == null) return undefined;
  const octets = match.slice(1).map(Number);
  return octets.every((octet) => octet <= 255) ? octets : undefined;
}

function isPrivateIpv4(octets: readonly number[]): boolean {
  const [a, b] = octets;
  // Mirrors PRIVATE_SUBNET_DENYLIST above: 0/8, 10/8, 100.64/10, 127/8,
  // 169.254/16, 172.16/12, 192.168/16.
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

/**
 * Belt-and-braces pre-flight validation before spending sandbox time: the
 * microVM firewall (BROWSE_NETWORK_POLICY) is the real enforcement layer, but
 * rejecting obviously-internal targets here fails fast with an actionable
 * message instead of a generic navigation error. http/https only; "localhost"
 * and literal private/loopback/link-local/CGNAT IPs are refused.
 */
export function validateBrowseUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new BrowseUrlValidationError(`Not a valid absolute URL: ${JSON.stringify(rawUrl)}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BrowseUrlValidationError(`Only http(s) URLs can be browsed, got protocol ${JSON.stringify(url.protocol)}`);
  }
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new BrowseUrlValidationError("Refusing to browse localhost");
  }
  const ipv4 = parseIpv4(hostname);
  if (ipv4 !== undefined && isPrivateIpv4(ipv4)) {
    throw new BrowseUrlValidationError(`Refusing to browse private/reserved IP address ${hostname}`);
  }
  // Literal IPv6 hosts appear bracketed in URLs; hostname strips the brackets
  // in Node's URL, but some runtimes keep them, so check both forms.
  const ipv6 = hostname.replace(/^\[|\]$/g, "");
  if (ipv6.includes(":")) {
    if (ipv6 === "::" || ipv6 === "::1" || /^(fe[89ab]|f[cd])/.test(ipv6)) {
      throw new BrowseUrlValidationError(`Refusing to browse loopback/link-local/unique-local IPv6 address ${hostname}`);
    }
  }
  return url;
}

/**
 * Open `url` in a fresh browser microVM and return the rendered page's title,
 * final URL (after redirects), and interactive accessibility snapshot.
 *
 * `screenshot: true` additionally returns a base64 PNG of the viewport. The
 * screenshot artifact tool sends these bytes directly to the backend rather
 * than placing a large base64 payload in the model's context.
 *
 * One sandbox per call, torn down in the helper's `finally`: agent tool calls
 * are independent model turns and eve gives us no cross-call lifecycle hook to
 * safely reuse a VM without risking an unbounded session, so per-call VMs
 * (sub-second with a sandbox snapshot configured) are the robust choice.
 */
export async function browsePage(options: { readonly url: string, readonly screenshot: boolean }): Promise<BrowsePageResult> {
  const validatedUrl = validateBrowseUrl(options.url);
  if (!isBrowseSandboxAvailable()) {
    throw new Error(
      "Browser sandbox is unavailable outside a Vercel deployment or its credentials are missing. "
      + "Fall back to fetching the page with curl.",
    );
  }
  const hasSandboxSnapshot = process.env.AGENT_BROWSER_SNAPSHOT_ID != null && process.env.AGENT_BROWSER_SNAPSHOT_ID.length > 0;
  return await withAgentBrowserSandbox(async (sandbox) => {
    await runAgentBrowserCommand(sandbox, ["open", validatedUrl.toString()]);

    const titleResult = await runAgentBrowserCommand<{ data?: { title?: string } }>(sandbox, ["get", "title"]);
    const title = titleResult.json?.data?.title ?? "";

    const urlResult = await runAgentBrowserCommand<{ data?: { url?: string } }>(sandbox, ["get", "url"]);
    const finalUrl = urlResult.json?.data?.url ?? validatedUrl.toString();

    // Interactive + compact accessibility tree: the token-efficient page
    // representation agent-browser is built around. Not --json because the
    // plain-text tree is the model-facing format.
    const snapshotResult = await runAgentBrowserCommand(sandbox, ["snapshot", "-i", "-c"], { json: false });
    const fullSnapshot = snapshotResult.stdout.trim();
    const snapshotText = fullSnapshot.length > SNAPSHOT_CHAR_CAP
      ? `${fullSnapshot.slice(0, SNAPSHOT_CHAR_CAP)}\n… [snapshot truncated at ${SNAPSHOT_CHAR_CAP} characters]`
      : fullSnapshot;

    let screenshotBase64: string | undefined;
    if (options.screenshot) {
      const screenshotResult = await runAgentBrowserCommand<{ data?: { path?: string } }>(sandbox, ["screenshot"]);
      const screenshotPath = screenshotResult.json?.data?.path;
      if (screenshotPath == null) {
        throw new Error("agent-browser screenshot did not return a file path");
      }
      const base64Result = await sandbox.runCommand("base64", ["-w", "0", screenshotPath]);
      screenshotBase64 = (await base64Result.stdout()).trim();
    }

    await runAgentBrowserCommand(sandbox, ["close"], { json: false });

    return { finalUrl, title, snapshotText, ...screenshotBase64 === undefined ? {} : { screenshotBase64 } };
  }, {
    timeout: hasSandboxSnapshot ? SANDBOX_TIMEOUT_WITH_SNAPSHOT_MS : SANDBOX_TIMEOUT_COLD_BOOT_MS,
    createOptions: { networkPolicy: BROWSE_NETWORK_POLICY },
  });
}
