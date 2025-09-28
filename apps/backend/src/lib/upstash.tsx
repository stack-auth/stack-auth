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

  const url = new URL(fullReq.url);
  if ((getNodeEnvironment().includes("development") || getNodeEnvironment().includes("test")) && url.hostname === "localhost") {
    url.hostname = "host.docker.internal";
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
