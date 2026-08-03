// Stage-1 redaction (per the runtime contract): Marshal scrubs every sensitive value it
// handed to the build (org token, registry auth, webhook token, presigned URLs) from build
// logs before serving or persisting them. The values are assembled in
// services.ts::buildLogRedactionValues; the presigned URL signature is scrubbed by shape in
// redactBuildLogText. The backend applies stage 2 for its own secrets.
export function redactSecrets(text: string, secretValues: string[]): string {
  let result = text;
  for (const value of secretValues) {
    if (value.length === 0) continue;
    result = result.split(value).join("<redacted>");
  }
  return result;
}
