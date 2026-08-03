import { hexclaveAppInternalsSymbol } from "@/lib/hexclave-app-internals";

type HexclaveAppInternals = {
  sendRequest: (path: string, requestOptions: RequestInit, requestType?: "client" | "server" | "admin") => Promise<Response>,
};

function getStackAppInternals(appValue: unknown): HexclaveAppInternals {
  if (appValue == null || typeof appValue !== "object") {
    throw new Error("The Stack app instance is unavailable.");
  }
  const internals = Reflect.get(appValue, hexclaveAppInternalsSymbol);
  if (
    internals == null
    || typeof internals !== "object"
    || !("sendRequest" in internals)
    || typeof (internals as HexclaveAppInternals).sendRequest !== "function"
  ) {
    throw new Error("The Stack client app cannot send internal requests.");
  }
  return internals as HexclaveAppInternals;
}

export type BrainMessageDto = {
  id: string,
  position: number,
  role: string,
  content: unknown,
  visibility: string,
  created_at: string,
};

export type BrainStateDto = {
  enabled: boolean,
  pending_queue_count: number,
  run_state: "IDLE" | "RUNNING" | "NONE",
  messages: BrainMessageDto[],
  next_cursor: { position: number, id: string } | null,
};

export type BrainQueueItemDto = {
  id: string,
  type: string,
  schema_version: number,
  payload: unknown,
  occurred_at: string,
  subject_type: string | null,
  subject_id: string | null,
  status: string,
  attempts: number,
  last_error: string | null,
  available_at: string,
  created_at: string,
};

async function readJson(response: Response): Promise<unknown> {
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Brain API request failed (${response.status}): ${text}`);
  }
  return await response.json();
}

export async function fetchBrainState(app: unknown, options?: { limit?: number, cursor?: string }): Promise<BrainStateDto> {
  const internals = getStackAppInternals(app);
  const params = new URLSearchParams();
  if (options?.limit != null) params.set("limit", String(options.limit));
  if (options?.cursor != null) params.set("cursor", options.cursor);
  const qs = params.toString();
  const response = await internals.sendRequest(
    `/internal/brain${qs.length > 0 ? `?${qs}` : ""}`,
    { method: "GET" },
    "admin",
  );
  return await readJson(response) as BrainStateDto;
}

export async function postBrainMessage(app: unknown, text: string): Promise<{ message_id: string }> {
  const internals = getStackAppInternals(app);
  const response = await internals.sendRequest(
    "/internal/brain/messages",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    },
    "admin",
  );
  return await readJson(response) as { message_id: string };
}

export async function fetchBrainQueue(
  app: unknown,
  options?: { limit?: number, cursor?: string, status?: string },
): Promise<{ items: BrainQueueItemDto[], next_cursor: { created_at: string, id: string } | null }> {
  const internals = getStackAppInternals(app);
  const params = new URLSearchParams();
  if (options?.limit != null) params.set("limit", String(options.limit));
  if (options?.cursor != null) params.set("cursor", options.cursor);
  if (options?.status != null) params.set("status", options.status);
  const qs = params.toString();
  const response = await internals.sendRequest(
    `/internal/brain/queue${qs.length > 0 ? `?${qs}` : ""}`,
    { method: "GET" },
    "admin",
  );
  return await readJson(response) as { items: BrainQueueItemDto[], next_cursor: { created_at: string, id: string } | null };
}

export async function retryBrainQueueItems(app: unknown, ids: string[]): Promise<{ retried: number }> {
  const internals = getStackAppInternals(app);
  const response = await internals.sendRequest(
    "/internal/brain/queue",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    },
    "admin",
  );
  return await readJson(response) as { retried: number };
}
