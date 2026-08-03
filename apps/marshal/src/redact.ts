// Stage-1 redaction (per the runtime contract): Marshal scrubs every sensitive value it
// handed to the build (org token, registry auth, webhook token, presigned URLs) from build
// logs before serving or persisting them. The backend applies stage 2 for its own secrets.
export function redactSecrets(text: string, secretValues: string[]): string {
  let result = text;
  for (const value of secretValues) {
    if (value.length === 0) continue;
    result = result.split(value).join("<redacted>");
  }
  return result;
}

export function buildRedactionValues(options: { flyToken: string, registryAuthBase64: string, webhookToken: string, tarballUrl: string }): string[] {
  const values = [options.flyToken, options.registryAuthBase64, options.webhookToken, options.tarballUrl];
  // The token also appears without its "FlyV1 " scheme prefix in registry credentials.
  if (options.flyToken.startsWith("FlyV1 ")) values.push(options.flyToken.slice("FlyV1 ".length));
  // Presigned URL signatures leak in query strings even when the full URL doesn't match.
  const signature = /[?&]X-Amz-Signature=([^&\s]+)/i.exec(options.tarballUrl)?.[1];
  if (signature !== undefined) values.push(signature);
  return values;
}
