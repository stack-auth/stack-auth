import { getEnvVariable } from "@hexclave/shared/dist/utils/env";

export type BackendRequestCorrelation = {
  clientRequestId: string,
  requestId: string,
  method: string,
  path: string,
  status: number,
  durationMs: number,
};

const maxCorrelationRecords = 20_000;
const records: BackendRequestCorrelation[] = [];

export const backendRequestCorrelationEnabled = getEnvVariable("HEXCLAVE_E2E_DIAGNOSTICS", "") === "true";

export function recordBackendRequestCorrelation(record: BackendRequestCorrelation): void {
  if (!backendRequestCorrelationEnabled) return;
  if (records.length >= maxCorrelationRecords) records.shift();
  records.push(record);
}

export function getBackendRequestCorrelations(): BackendRequestCorrelation[] {
  return records.map(record => ({ ...record }));
}

export function clearBackendRequestCorrelations(): void {
  records.length = 0;
}
