import { nodeHttpTransport, type NodeHttpTransportInit } from "../src/lib/node-http-transport";
import { getCronRequestTimeoutMs } from "./run-cron-jobs-config";

export function cronFetch(
  input: string | URL,
  init: NodeHttpTransportInit | undefined,
  maxDurationMs: number | undefined,
): Promise<Response> {
  return nodeHttpTransport(input, init, getCronRequestTimeoutMs(maxDurationMs));
}
