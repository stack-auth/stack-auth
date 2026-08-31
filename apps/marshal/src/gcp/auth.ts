import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";

const CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const METADATA_TOKEN_URL = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";
const TOKEN_REFRESH_SKEW_MILLIS = 5 * 60 * 1000;

type AccessToken = {
  value: string,
  expiresAtMillis: number,
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

async function serviceAccountToken(credential: ServiceAccountCredential): Promise<AccessToken> {
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

async function metadataToken(): Promise<AccessToken> {
  const response = await fetch(METADATA_TOKEN_URL, { headers: { "Metadata-Flavor": "Google" } });
  const body: unknown = await response.json();
  if (!response.ok || !isRecord(body) || typeof body.access_token !== "string" || typeof body.expires_in !== "number") {
    throw new Error(`Google metadata token request failed with HTTP ${response.status}`);
  }
  return { value: body.access_token, expiresAtMillis: Date.now() + body.expires_in * 1000 };
}

let cachedToken: AccessToken | null = null;
let cachedCredential: ServiceAccountCredential | null = null;
let cachedCredentialPath: string | null = null;

async function applicationCredential(): Promise<ServiceAccountCredential | null> {
  const path = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (path === undefined || path === "") return null;
  if (cachedCredential !== null && cachedCredentialPath === path) return cachedCredential;
  const serialized = await readFile(path, "utf8");
  // Never include credential contents in errors. The path is operational configuration;
  // private key material remains confined to this module and the OAuth assertion.
  const parsed: unknown = JSON.parse(serialized);
  cachedCredential = parseServiceAccountCredential(parsed, path);
  cachedCredentialPath = path;
  return cachedCredential;
}

export async function googleAccessToken(): Promise<string> {
  if (cachedToken !== null && cachedToken.expiresAtMillis - TOKEN_REFRESH_SKEW_MILLIS > Date.now()) return cachedToken.value;
  const credential = await applicationCredential();
  cachedToken = credential === null ? await metadataToken() : await serviceAccountToken(credential);
  return cachedToken.value;
}

export function resetGoogleAuthCacheForTests(): void {
  cachedToken = null;
  cachedCredential = null;
  cachedCredentialPath = null;
}
