import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";

const CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const METADATA_TOKEN_URL = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";
const STS_TOKEN_URL = "https://sts.googleapis.com/v1/token";
const IAM_CREDENTIALS_URL = "https://iamcredentials.googleapis.com/v1";
// The platform-injected OIDC assertion. Vercel writes this per invocation; another host that
// mints one under a different name is configured through
// HEXCLAVE_MARSHAL_GCP_WORKLOAD_IDENTITY_TOKEN_ENV.
const DEFAULT_OIDC_TOKEN_ENV_VAR = "VERCEL_OIDC_TOKEN";
const TOKEN_REFRESH_SKEW_MILLIS = 5 * 60 * 1000;

type AccessToken = {
  value: string,
  expiresAtMillis: number,
};

// Workload Identity Federation: the host proves its identity with a short-lived OIDC
// assertion, Google exchanges it for a federated token, and that token impersonates the
// controller service account. There is no long-lived key anywhere in this path, which is why
// it is preferred over GOOGLE_APPLICATION_CREDENTIALS for a hosted deployment — the
// controller identity can create, bill, and delete every tenant project, so a static key for
// it is the most valuable secret the system would otherwise hold.
type WorkloadIdentityConfig = {
  audience: string,
  serviceAccountEmail: string,
  tokenEnvVar: string,
};

type ServiceAccountCredential = {
  clientEmail: string,
  privateKey: string,
  tokenUri: string,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseServiceAccountCredential(value: unknown, path: string): ServiceAccountCredential {
  if (!isRecord(value)) throw new Error(`Google application credential ${path} must contain a JSON object`);
  const clientEmail = value.client_email;
  const privateKey = value.private_key;
  const tokenUri = value.token_uri;
  if (typeof clientEmail !== "string" || clientEmail === "") throw new Error(`Google application credential ${path} has no client_email`);
  if (typeof privateKey !== "string" || privateKey === "") throw new Error(`Google application credential ${path} has no private_key`);
  if (tokenUri !== undefined && typeof tokenUri !== "string") throw new Error(`Google application credential ${path} has an invalid token_uri`);
  return { clientEmail, privateKey, tokenUri: tokenUri ?? TOKEN_URL };
}

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

async function serviceAccountToken(credential: ServiceAccountCredential, signal?: AbortSignal): Promise<AccessToken> {
  const issuedAtSeconds = Math.floor(Date.now() / 1000);
  const expiresAtSeconds = issuedAtSeconds + 3600;
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({
    iss: credential.clientEmail,
    scope: CLOUD_PLATFORM_SCOPE,
    aud: credential.tokenUri,
    iat: issuedAtSeconds,
    exp: expiresAtSeconds,
  }));
  const unsigned = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const assertion = `${unsigned}.${base64Url(signer.sign(credential.privateKey))}`;
  const response = await fetch(credential.tokenUri, {
    method: "POST",
    signal,
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const body: unknown = await response.json();
  if (!response.ok || !isRecord(body) || typeof body.access_token !== "string" || typeof body.expires_in !== "number") {
    throw new Error(`Google OAuth token exchange failed with HTTP ${response.status}`);
  }
  return { value: body.access_token, expiresAtMillis: Date.now() + body.expires_in * 1000 };
}

async function metadataToken(signal?: AbortSignal): Promise<AccessToken> {
  const response = await fetch(METADATA_TOKEN_URL, { signal, headers: { "Metadata-Flavor": "Google" } });
  const body: unknown = await response.json();
  if (!response.ok || !isRecord(body) || typeof body.access_token !== "string" || typeof body.expires_in !== "number") {
    throw new Error(`Google metadata token request failed with HTTP ${response.status}`);
  }
  return { value: body.access_token, expiresAtMillis: Date.now() + body.expires_in * 1000 };
}

function workloadIdentityConfig(): WorkloadIdentityConfig | null {
  const audience = (process.env.HEXCLAVE_MARSHAL_GCP_WORKLOAD_IDENTITY_AUDIENCE || "").trim();
  const serviceAccountEmail = (process.env.HEXCLAVE_MARSHAL_GCP_WORKLOAD_IDENTITY_SERVICE_ACCOUNT || "").trim();
  if (audience === "" && serviceAccountEmail === "") return null;
  // Half-configured federation must fail loudly rather than silently falling through to the
  // metadata server, which on a host that has none would surface as an unrelated fetch error.
  if (audience === "" || serviceAccountEmail === "") {
    throw new Error("workload identity federation needs both HEXCLAVE_MARSHAL_GCP_WORKLOAD_IDENTITY_AUDIENCE and HEXCLAVE_MARSHAL_GCP_WORKLOAD_IDENTITY_SERVICE_ACCOUNT");
  }
  return {
    audience,
    serviceAccountEmail,
    tokenEnvVar: (process.env.HEXCLAVE_MARSHAL_GCP_WORKLOAD_IDENTITY_TOKEN_ENV || "").trim() || DEFAULT_OIDC_TOKEN_ENV_VAR,
  };
}

async function workloadIdentityToken(config: WorkloadIdentityConfig, signal?: AbortSignal): Promise<AccessToken> {
  // Deliberately read at every refresh rather than cached with the credential: the host
  // re-injects this assertion per invocation and the previous one expires within the hour, so
  // a value captured at import time would start failing partway through the process's life.
  const subjectToken = (process.env[config.tokenEnvVar] || "").trim();
  if (subjectToken === "") {
    throw new Error(`workload identity federation is configured but ${config.tokenEnvVar} is empty; the host did not inject an OIDC token`);
  }

  const exchange = await fetch(STS_TOKEN_URL, {
    method: "POST",
    signal,
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      audience: config.audience,
      scope: CLOUD_PLATFORM_SCOPE,
      requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
      subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
      subject_token: subjectToken,
    }),
  });
  const exchanged: unknown = await exchange.json();
  // Status only, never the body: an STS error can echo the assertion back.
  if (!exchange.ok || !isRecord(exchanged) || typeof exchanged.access_token !== "string") {
    throw new Error(`Google STS token exchange failed with HTTP ${exchange.status}`);
  }

  const impersonation = await fetch(
    `${IAM_CREDENTIALS_URL}/projects/-/serviceAccounts/${encodeURIComponent(config.serviceAccountEmail)}:generateAccessToken`,
    {
      method: "POST",
      signal,
      headers: { authorization: `Bearer ${exchanged.access_token}`, "content-type": "application/json" },
      body: JSON.stringify({ scope: [CLOUD_PLATFORM_SCOPE] }),
    },
  );
  const impersonated: unknown = await impersonation.json();
  if (!impersonation.ok || !isRecord(impersonated) || typeof impersonated.accessToken !== "string" || typeof impersonated.expireTime !== "string") {
    throw new Error(`Google service account impersonation failed with HTTP ${impersonation.status}`);
  }
  const expiresAtMillis = Date.parse(impersonated.expireTime);
  // An unparseable expiry must not be treated as far future: that would cache a token past its
  // life and turn every later call into a 401 with no refresh.
  if (!Number.isFinite(expiresAtMillis)) throw new Error("Google service account impersonation returned an unparseable expiry");
  return { value: impersonated.accessToken, expiresAtMillis };
}

let cachedToken: AccessToken | null = null;
let cachedCredential: ServiceAccountCredential | null = null;
let cachedCredentialPath: string | null = null;

async function applicationCredential(signal?: AbortSignal): Promise<ServiceAccountCredential | null> {
  const path = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (path === undefined || path === "") return null;
  if (cachedCredential !== null && cachedCredentialPath === path) return cachedCredential;
  const serialized = await readFile(path, { encoding: "utf8", signal });
  // Never include credential contents in errors. The path is operational configuration;
  // private key material remains confined to this module and the OAuth assertion.
  const parsed: unknown = JSON.parse(serialized);
  cachedCredential = parseServiceAccountCredential(parsed, path);
  cachedCredentialPath = path;
  return cachedCredential;
}

// Federation first, then an explicit credential file, then the metadata server. Federation
// leads because it is the only one of the three a hosted platform can offer without a stored
// secret, and a host that has it configured never wants either fallback.
export async function googleAccessToken(signal?: AbortSignal): Promise<string> {
  if (cachedToken !== null && cachedToken.expiresAtMillis - TOKEN_REFRESH_SKEW_MILLIS > Date.now()) return cachedToken.value;
  const federation = workloadIdentityConfig();
  if (federation !== null) {
    cachedToken = await workloadIdentityToken(federation, signal);
    return cachedToken.value;
  }
  const credential = await applicationCredential(signal);
  cachedToken = credential === null ? await metadataToken(signal) : await serviceAccountToken(credential, signal);
  return cachedToken.value;
}

export function resetGoogleAuthCacheForTests(): void {
  cachedToken = null;
  cachedCredential = null;
  cachedCredentialPath = null;
}
