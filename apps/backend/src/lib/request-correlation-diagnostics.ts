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
let recordHead = 0;
let recordCount = 0;
const compactDiagnosticRequestId = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const backendRequestCorrelationEnabled = getEnvVariable("HEXCLAVE_E2E_DIAGNOSTICS", "") === "true";

export function recordBackendRequestCorrelation(record: BackendRequestCorrelation): void {
  if (!backendRequestCorrelationEnabled) return;
  if (!compactDiagnosticRequestId.test(record.clientRequestId)) return;
  const index = (recordHead + recordCount) % maxCorrelationRecords;
  records[index] = record;
  if (recordCount < maxCorrelationRecords) {
    recordCount++;
  } else {
    recordHead = (recordHead + 1) % maxCorrelationRecords;
  }
}

export function getBackendRequestCorrelations(): BackendRequestCorrelation[] {
  return Array.from({ length: recordCount }, (_, offset) => {
    const record = records[(recordHead + offset) % maxCorrelationRecords];
    return { ...record };
  });
}

export function clearBackendRequestCorrelations(): void {
  records.length = 0;
  recordHead = 0;
  recordCount = 0;
}
