"use client";

import {
  REMOTE_DEVELOPMENT_ENVIRONMENT_BROWSER_SECRET_ERROR_HEADER,
  REMOTE_DEVELOPMENT_ENVIRONMENT_BROWSER_SECRET_INVALID_ERROR_CODE,
} from "@/lib/remote-development-environment/browser-secret-common";

export class RemoteDevelopmentEnvironmentBrowserSecretRedirectingError extends Error {
  constructor() {
    super("Redirecting to development environment browser authorization.");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function responseHasInvalidBrowserSecretError(response: Response): Promise<boolean> {
  if (response.headers.get(REMOTE_DEVELOPMENT_ENVIRONMENT_BROWSER_SECRET_ERROR_HEADER) === REMOTE_DEVELOPMENT_ENVIRONMENT_BROWSER_SECRET_INVALID_ERROR_CODE) {
    return true;
  }

  let body: unknown;
  try {
    body = await response.clone().json();
  } catch {
    return false;
  }
  if (!isRecord(body)) return false;
  return body.code === REMOTE_DEVELOPMENT_ENVIRONMENT_BROWSER_SECRET_INVALID_ERROR_CODE;
}

function redirectToBrowserSecretConfirmation(): never {
  const url = new URL("/development-environment/browser-secret", window.location.href);
  url.searchParams.set("return_to", window.location.href);
  window.location.assign(url.toString());
  throw new RemoteDevelopmentEnvironmentBrowserSecretRedirectingError();
}

function parseLocalboundStartResponse(value: unknown): { url: string } {
  if (!isRecord(value) || typeof value.url !== "string") {
    throw new Error("Development environment local browser-secret endpoint returned an invalid response.");
  }
  return { url: value.url };
}

function parseBrowserSecretResponse(value: unknown): { browserSecret: string } {
  if (!isRecord(value) || typeof value.browser_secret !== "string") {
    throw new Error("Development environment browser-secret endpoint returned an invalid response.");
  }
  return { browserSecret: value.browser_secret };
}

export async function storeRemoteDevelopmentEnvironmentBrowserSecret(browserSecret: string): Promise<void> {
  const response = await fetch("/api/development-environment/browser-secret/store", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ browser_secret: browserSecret }),
  });
  if (!response.ok) {
    throw new Error(`Failed to store development environment browser secret (${response.status}): ${await response.text()}`);
  }
}

async function tryInstallBrowserSecretFromLocalboundServer(): Promise<boolean> {
  const startResponse = await fetch("/api/development-environment/browser-secret/start-localbound-server", {
    method: "POST",
    headers: {
      Accept: "application/json",
    },
  });
  if (!startResponse.ok) {
    return false;
  }

  const { url } = parseLocalboundStartResponse(await startResponse.json());
  let localboundResponse: Response;
  try {
    localboundResponse = await fetch(url, {
      cache: "no-store",
      credentials: "omit",
      headers: {
        Accept: "application/json",
      },
    });
  } catch {
    return false;
  }
  if (!localboundResponse.ok) {
    return false;
  }

  const { browserSecret } = parseBrowserSecretResponse(await localboundResponse.json());
  await storeRemoteDevelopmentEnvironmentBrowserSecret(browserSecret);
  return true;
}

async function ensureRemoteDevelopmentEnvironmentBrowserSecret(): Promise<void> {
  if (await tryInstallBrowserSecretFromLocalboundServer()) return;
  redirectToBrowserSecretConfirmation();
}

export async function fetchWithRemoteDevelopmentEnvironmentBrowserSecret(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, init);
  if (!await responseHasInvalidBrowserSecretError(response)) {
    return response;
  }

  await ensureRemoteDevelopmentEnvironmentBrowserSecret();
  return await fetch(input, init);
}
