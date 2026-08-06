import "../src/load-env.js";

function parseTimestamp(value: string) {
  const millis = /^\d+$/.test(value) ? Number(value) : Date.parse(value);
  if (!Number.isSafeInteger(millis) || millis < 0) {
    throw new Error("GC cutoff must be an ISO-8601 timestamp or non-negative epoch milliseconds");
  }
  return millis;
}

function parseMaxObjects(value: string | undefined) {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error("GC maxObjects must be a positive safe integer");
  return parsed;
}

if (process.argv.length < 3) {
  throw new Error("Usage: pnpm gc:piledriver <ISO timestamp | epoch milliseconds> [max objects]");
}
const cutoffArgument = process.argv[2];

const secret = process.env.HEXCLAVE_BULLDOZER_SERVER_SECRET;
if (secret === undefined || secret.length === 0) throw new Error("HEXCLAVE_BULLDOZER_SERVER_SECRET must be set");
const configuredBaseUrl = process.env.HEXCLAVE_BULLDOZER_SERVER_URL;
const baseUrl = configuredBaseUrl === undefined || configuredBaseUrl.length === 0
  ? `http://localhost:${process.env.NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX ?? "81"}46`
  : configuredBaseUrl;
const cutoffTimestampMillis = parseTimestamp(cutoffArgument);
const maxObjects = parseMaxObjects(process.argv[3]);
const endpointUrl = new URL("/internal/piledriver-gc", baseUrl);
const requestStartedAtMillis = Date.now();
const requestStartedAt = performance.now();

const response = await fetch(endpointUrl, {
  method: "POST",
  headers: {
    "authorization": `Bearer ${secret}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    cutoffTimestampMillis,
    ...(maxObjects === undefined ? {} : { maxObjects }),
  }),
});
if (!response.ok) {
  throw new Error(
    `Piledriver GC request to ${endpointUrl.toString()} failed with HTTP ${response.status}`
    + ` (cutoff=${new Date(cutoffTimestampMillis).toISOString()}, maxObjects=${maxObjects ?? 1000}): ${await response.text()}`,
  );
}
const result: unknown = await response.json();
const requestCompletedAtMillis = Date.now();
console.log(JSON.stringify({
  command: "piledriver-gc",
  request: {
    endpoint: endpointUrl.toString(),
    cutoffTimestampMillis,
    cutoffTimestampIso: new Date(cutoffTimestampMillis).toISOString(),
    maxObjects: maxObjects ?? 1000,
    startedAtMillis: requestStartedAtMillis,
    completedAtMillis: requestCompletedAtMillis,
    httpRoundTripMillis: performance.now() - requestStartedAt,
    clientProcessId: process.pid,
    nodeVersion: process.version,
  },
  result,
}, null, 2));
