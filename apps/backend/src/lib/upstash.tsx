import { SmartRequest } from "@/route-handlers/smart-request";
import { getEnvVariable, getNodeEnvironment } from "@stackframe/stack-shared/dist/utils/env";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { Client, Receiver } from "@upstash/qstash";

export const upstash = new Client({
  baseUrl: getEnvVariable("STACK_QSTASH_URL", ""),
  token: getEnvVariable("STACK_QSTASH_TOKEN", ""),
});

export const upstashReceiver = new Receiver({
  currentSigningKey: getEnvVariable("STACK_QSTASH_CURRENT_SIGNING_KEY", ""),
  nextSigningKey: getEnvVariable("STACK_QSTASH_NEXT_SIGNING_KEY", ""),
});

export async function ensureUpstashSignature(fullReq: SmartRequest): Promise<void> {
  const upstashSignature = fullReq.headers["upstash-signature"]?.[0];
  if (!upstashSignature) {
    throw new StatusError(400, "upstash-signature header is required");
  }

  const nodeEnv = getNodeEnvironment();
  if ((nodeEnv.includes("development") || nodeEnv.includes("test")) && upstashSignature === "test-bypass") {
    return;
  }

  const url = new URL(fullReq.url);
  if ((nodeEnv.includes("development") || nodeEnv.includes("test")) && url.hostname === "localhost") {
    url.hostname = "host.docker.internal";
  }
  // The backend binds to 0.0.0.0, so Next.js reports the incoming URL with that
  // hostname. QStash signs the URL we told it to call (e.g. localhost), so
  // normalize 0.0.0.0 back to localhost for signature verification.
  if (url.hostname === "0.0.0.0") {
    url.hostname = "localhost";
  }

  const isValid = await upstashReceiver.verify({
    signature: upstashSignature,
    url: url.toString(),
    body: new TextDecoder().decode(fullReq.bodyBuffer),
  });
  if (!isValid) {
    throw new StatusError(400, "Invalid Upstash signature");
  }
}
