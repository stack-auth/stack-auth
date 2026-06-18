import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";

function getBulldozerServerBaseUrl(): string {
  const configuredUrl = getEnvVariable("HEXCLAVE_BULLDOZER_SERVER_URL", "");
  if (configuredUrl) {
    return configuredUrl.replace(/\/$/, "");
  }
  return `http://localhost:${getEnvVariable("NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX", "81")}46`;
}

function encodePathSegment(segment: string): string {
  return encodeURIComponent(segment);
}

export function bulldozerCustomerPath(options: {
  tenancyId: string,
  customerType: "user" | "team" | "custom",
  customerId: string,
  suffix: string,
}): string {
  return `/v1/${encodePathSegment(options.tenancyId)}/customers/${encodePathSegment(options.customerType)}/${encodePathSegment(options.customerId)}/${options.suffix}`;
}

export async function fetchBulldozerServerJson<T>(options: {
  method: "GET" | "POST",
  path: string,
  body?: unknown,
}): Promise<T> {
  const response = await fetch(`${getBulldozerServerBaseUrl()}${options.path}`, {
    method: options.method,
    headers: {
      "content-type": "application/json",
    },
    ...options.body === undefined ? {} : { body: JSON.stringify(options.body) },
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new HexclaveAssertionError("Bulldozer server request failed", {
      method: options.method,
      path: options.path,
      status: response.status,
      responseText,
    });
  }

  return await response.json() as T;
}
