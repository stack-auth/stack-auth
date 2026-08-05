import { executeJavascript } from "@/lib/js-execution";
import { HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";
import { z } from "zod";

export const BRAIN_JAVASCRIPT_MAX_BATCH_SIZE = 200;
export const BRAIN_JAVASCRIPT_DEFAULT_BATCH_SIZE = 25;
export const BRAIN_JAVASCRIPT_MAX_CODE_BYTES = 50_000;
export const BRAIN_JAVASCRIPT_MAX_MEMORY_BYTES = 50_000;
export const BRAIN_JAVASCRIPT_MAX_BATCH_BYTES = 4 * 1024 * 1024;
export const BRAIN_JAVASCRIPT_MAX_RESULT_BYTES = 1024 * 1024;
const BRAIN_JAVASCRIPT_TIMEOUT_MS = 30_000;
const BRAIN_JAVASCRIPT_PROTOCOL_VERSION = 1;

export type BrainJavascriptQueueItem = {
  id: string,
  type: string,
  schemaVersion: number,
  payload: unknown,
  occurredAt: string,
  subjectType: string | null,
  subjectId: string | null,
  attempts: number,
};

const brainJavascriptActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("acknowledge"),
    ids: z.array(z.string().uuid()).max(BRAIN_JAVASCRIPT_MAX_BATCH_SIZE),
  }),
  z.object({
    type: z.literal("release"),
    ids: z.array(z.string().uuid()).max(BRAIN_JAVASCRIPT_MAX_BATCH_SIZE),
    error: z.string().max(2000).nullable(),
    fail: z.boolean(),
  }),
]);

const brainJavascriptOutcomeSchema = z.object({
  protocolVersion: z.literal(BRAIN_JAVASCRIPT_PROTOCOL_VERSION),
  result: z.unknown(),
  actions: z.array(brainJavascriptActionSchema).max(BRAIN_JAVASCRIPT_MAX_BATCH_SIZE),
  memory: z.record(z.string(), z.unknown()),
});

export type BrainJavascriptOutcome = z.infer<typeof brainJavascriptOutcomeSchema>;

function buildBrainJavascriptProgram(options: {
  code: string,
  items: BrainJavascriptQueueItem[],
  memory: Record<string, unknown>,
}): string {
  const itemsJson = JSON.stringify(options.items);
  const memoryJson = JSON.stringify(options.memory);
  return `
export default async function runBrainJavascript() {
  // Parse serialized data instead of emitting it as an object literal. In
  // particular, a payload key named "__proto__" must remain ordinary data.
  const items = JSON.parse(${JSON.stringify(itemsJson)});
  const memory = JSON.parse(${JSON.stringify(memoryJson)});
  const byId = new Map(items.map((item) => [item.id, item]));
  const fetchedIds = new Set();
  const finalizedIds = new Set();
  const actions = [];

  const normalizeIds = (ids) => {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new Error("Expected a non-empty array of queue item ids");
    }
    const unique = [...new Set(ids)];
    for (const id of unique) {
      if (typeof id !== "string" || !byId.has(id)) {
        throw new Error("Queue action referenced an item outside this JavaScript batch");
      }
      if (finalizedIds.has(id)) {
        throw new Error("A queue item can only be acknowledged or released once");
      }
    }
    return unique;
  };

  const release = (ids, options = {}) => {
    const normalized = normalizeIds(ids);
    const error = options.error == null ? null : String(options.error).slice(0, 2000);
    const fail = options.fail === true;
    normalized.forEach((id) => finalizedIds.add(id));
    actions.push({ type: "release", ids: normalized, error, fail });
    return normalized.length;
  };

  const brain = Object.freeze({
    fetch(options = {}) {
      const limit = Math.max(1, Math.min(Number.isInteger(options.limit) ? options.limit : items.length, items.length));
      const types = options.types == null ? null : new Set(options.types);
      const selected = [];
      for (const item of items) {
        if (selected.length >= limit) break;
        if (fetchedIds.has(item.id) || finalizedIds.has(item.id)) continue;
        if (types != null && !types.has(item.type)) continue;
        fetchedIds.add(item.id);
        selected.push(structuredClone(item));
      }
      return selected;
    },
    acknowledge(ids) {
      const normalized = normalizeIds(ids);
      normalized.forEach((id) => finalizedIds.add(id));
      actions.push({ type: "acknowledge", ids: normalized });
      return normalized.length;
    },
    release,
    fail(ids, error) {
      return release(ids, { error, fail: true });
    },
    recall(key) {
      if (key == null) return structuredClone(memory);
      if (typeof key !== "string") throw new Error("Memory keys must be strings");
      return structuredClone(memory[key]);
    },
    remember(key, value) {
      if (typeof key !== "string" || !/^[a-zA-Z0-9._-]{1,200}$/.test(key)) {
        throw new Error("Memory keys must contain 1-200 letters, digits, dots, underscores, or hyphens");
      }
      if (key === "__proto__" || key === "prototype" || key === "constructor") {
        throw new Error("Reserved JavaScript property names cannot be used as memory keys");
      }
      memory[key] = structuredClone(value);
    },
    forget(key) {
      if (typeof key !== "string") throw new Error("Memory keys must be strings");
      delete memory[key];
    },
    stats() {
      return {
        supplied: items.length,
        fetched: fetchedIds.size,
        acknowledged: actions.filter((action) => action.type === "acknowledge")
          .reduce((sum, action) => sum + action.ids.length, 0),
        released: actions.filter((action) => action.type === "release")
          .reduce((sum, action) => sum + action.ids.length, 0),
        untouched: items.length - finalizedIds.size,
      };
    },
  });

  try {
    const result = await (async (brain) => {
${options.code}
    })(brain);
    const outcome = {
      protocolVersion: ${BRAIN_JAVASCRIPT_PROTOCOL_VERSION},
      result,
      actions,
      memory,
    };
    // Fail inside the sandbox with a useful message for cycles, BigInts, and
    // other values that cannot cross the execution-provider boundary.
    return { status: "ok", data: JSON.parse(JSON.stringify(outcome)) };
  } catch (error) {
    return {
      status: "error",
      error: {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
    };
  }
}
`;
}

export async function executeBrainJavascript(options: {
  code: string,
  items: BrainJavascriptQueueItem[],
  memory: Record<string, unknown>,
}): Promise<BrainJavascriptOutcome> {
  if (Buffer.byteLength(options.code, "utf8") > BRAIN_JAVASCRIPT_MAX_CODE_BYTES) {
    throw new HexclaveAssertionError("Brain JavaScript exceeded the code-size limit");
  }
  if (Buffer.byteLength(JSON.stringify(options.items), "utf8") > BRAIN_JAVASCRIPT_MAX_BATCH_BYTES) {
    throw new HexclaveAssertionError("Brain JavaScript exceeded the queue-batch payload limit");
  }
  if (Buffer.byteLength(JSON.stringify(options.memory), "utf8") > BRAIN_JAVASCRIPT_MAX_MEMORY_BYTES) {
    throw new HexclaveAssertionError("Brain JavaScript memory exceeded the size limit");
  }
  if (options.items.length > BRAIN_JAVASCRIPT_MAX_BATCH_SIZE) {
    throw new HexclaveAssertionError("Brain JavaScript exceeded the queue-batch item limit");
  }

  let timeout: NodeJS.Timeout | undefined;
  const timeoutMarker = Symbol("brain-javascript-timeout");
  const timeoutPromise = new Promise<typeof timeoutMarker>((resolve) => {
    timeout = setTimeout(() => resolve(timeoutMarker), BRAIN_JAVASCRIPT_TIMEOUT_MS);
  });
  const execution = await Promise.race([
    executeJavascript(buildBrainJavascriptProgram(options), {
      nodeModules: {},
      // Give Vercel setup a small grace period; the caller-side timer below
      // is authoritative and also covers Freestyle.
      executionTimeoutMs: BRAIN_JAVASCRIPT_TIMEOUT_MS + 5_000,
      // The provider fallback may retry, but the sandbox only returns an
      // action journal. Queue mutations happen once on the trusted host.
      disableSanityTest: true,
      // Queue payloads and persistent memory are embedded in the generated
      // program, so error telemetry must never include the raw source.
      logSafeCode: `<Brain JavaScript: ${options.code.length} user-code characters, ${options.items.length} queue items>`,
    }),
    timeoutPromise,
  ]).finally(() => clearTimeout(timeout));
  if (execution === timeoutMarker) {
    throw new HexclaveAssertionError("Brain JavaScript execution timed out");
  }
  if (execution.status === "error") {
    // The model-authored exception may include queue payload values. Keep it
    // out of traces and telemetry rather than treating arbitrary text as safe.
    throw new HexclaveAssertionError("Brain JavaScript execution failed");
  }

  const parsed = brainJavascriptOutcomeSchema.safeParse(execution.data);
  if (!parsed.success) {
    throw new HexclaveAssertionError("Brain JavaScript returned a malformed result", {
      issues: parsed.error.issues,
    });
  }
  if (Buffer.byteLength(JSON.stringify(parsed.data.memory), "utf8") > BRAIN_JAVASCRIPT_MAX_MEMORY_BYTES) {
    throw new HexclaveAssertionError("Brain JavaScript memory exceeded the size limit");
  }
  if (Buffer.byteLength(JSON.stringify(parsed.data.result ?? null), "utf8") > BRAIN_JAVASCRIPT_MAX_RESULT_BYTES) {
    throw new HexclaveAssertionError("Brain JavaScript result exceeded the size limit");
  }
  return parsed.data;
}
