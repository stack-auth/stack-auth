// Stage-1 redaction (per the runtime contract): Marshal scrubs every sensitive value it
// handed to the build (org token, registry auth, webhook token, presigned URLs) from build
// logs before serving or persisting them. The values are assembled in
// services.ts::buildLogRedactionValues; the presigned URL signature is scrubbed by shape in
// redactBuildLogText. The backend applies stage 2 for its own secrets.
export function redactSecrets(text: string, secretValues: string[]): string {
  let result = text;
  // LONGEST FIRST, not caller order. A value that is a PREFIX of another one
  // would otherwise be replaced first and destroy the longer match, leaving its
  // tail in the log: with "abc" before "abcdef", "abcdef" becomes
  // "<redacted>def". Kept in sync with the backend's stage-2 copy.
  for (const value of [...secretValues].sort((a, b) => b.length - a.length)) {
    if (value.length === 0) continue;
    result = result.split(value).join("<redacted>");
  }
  return result;
}
