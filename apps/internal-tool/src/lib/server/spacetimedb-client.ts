import "server-only";

import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { HexclaveAssertionError, StatusError } from "@hexclave/shared/dist/utils/errors";

const SPACETIMEDB_FETCH_TIMEOUT_MS = 10_000;

function requiredEnv(name: string): string {
  const value = getEnvVariable(name, "");
  if (value.trim() === "") {
    throw new HexclaveAssertionError(`${name} is not configured for the internal tool.`);
  }
  return value;
}

function httpBase(): string {
  return requiredEnv("STACK_SPACETIMEDB_URL");
}

// All calls authenticate with a token minted by the internal tool (a signed-in
// reviewer's token, or the service token for backend-ingested telemetry).
// SpacetimeDB validates it via OIDC discovery against the tool's issuer; the
// module authorizes on issuer + audience only — any valid member token grants
// full read/write.
export async function callReducerStrict(accessToken: string, reducer: string, args: unknown[]): Promise<void> {
  const base = httpBase();
  const dbName = requiredEnv("STACK_SPACETIMEDB_DB_NAME");
  const res = await fetch(`${base}/v1/database/${encodeURIComponent(dbName)}/call/${encodeURIComponent(reducer)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${accessToken}`,
    },
    body: JSON.stringify(args, (_, value) => {
      if (typeof value !== "bigint") return value;
      const max = BigInt(Number.MAX_SAFE_INTEGER);
      if (value <= max && value >= -max) return Number(value);
      return value.toString();
    }),
    signal: AbortSignal.timeout(SPACETIMEDB_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    const preview = (await res.text()).slice(0, 200);
    throw spacetimeDbError(`Reducer ${reducer} failed`, res.status, preview);
  }
}

function spacetimeDbError(label: string, status: number, preview: string): Error {
  const detail = `${label} (${status}): ${preview}`;
  if (status >= 400 && status < 500) return new StatusError(status, detail);
  if (status >= 500) return new StatusError(StatusError.BadGateway, `${label} (upstream ${status})`);
  return new HexclaveAssertionError(detail);
}

export function opt<T>(value: T | null | undefined): { some: T } | { none: [] } {
  return value == null ? { none: [] } : { some: value };
}

export async function callSql(accessToken: string, sql: string): Promise<Record<string, unknown>[]> {
  const base = httpBase();
  const dbName = requiredEnv("STACK_SPACETIMEDB_DB_NAME");
  const res = await fetch(`${base}/v1/database/${encodeURIComponent(dbName)}/sql`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${accessToken}` },
    body: sql,
    signal: AbortSignal.timeout(SPACETIMEDB_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    const preview = (await res.text()).slice(0, 200);
    throw spacetimeDbError("SQL query failed", res.status, preview);
  }
  const parsed = await res.json() as Array<{
    schema: { elements: Array<{ name: { some?: string } | null }> },
    rows: unknown[][],
  }>;
  if (parsed.length === 0) return [];
  const first = parsed[0];
  const cols = first.schema.elements.map(e => e.name?.some ?? "");
  return first.rows.map(row => {
    const obj: Record<string, unknown> = {};
    cols.forEach((col, i) => {
      obj[col] = row[i];
    });
    return obj;
  });
}
