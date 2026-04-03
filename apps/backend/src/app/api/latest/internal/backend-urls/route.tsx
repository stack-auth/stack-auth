import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { urlSchema, yupArray, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { getDefaultApiUrls } from "@stackframe/stack-shared/dist/utils/urls";

/**
 * Env var format: JSON object mapping probability (as string number) to URL arrays.
 * Probabilities must sum to <= 1. Remaining probability uses the last entry as fallback.
 *
 * Example:
 * {
 *   "0.7": ["https://api.stack-auth.com", "https://api2.stack-auth.com"],
 *   "0.3": ["https://api2.stack-auth.com", "https://api.stack-auth.com"]
 * }
 */

const urlsArraySchema = yupArray(urlSchema.defined()).min(1).defined();

export function parseAndValidateConfig(raw: unknown): Array<{ probability: number, urls: string[] }> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new StackAssertionError("STACK_BACKEND_URLS_CONFIG must be a JSON object mapping probability strings to URL arrays");
  }

  const entries = Object.entries(raw as Record<string, unknown>).map(([key, value]) => {
    const probability = Number(key);
    if (isNaN(probability) || probability < 0 || probability > 1) {
      throw new StackAssertionError(`Invalid probability key "${key}": must be a number between 0 and 1`);
    }
    const urls = urlsArraySchema.validateSync(value);
    return { probability, urls };
  });

  if (entries.length === 0) {
    throw new StackAssertionError("STACK_BACKEND_URLS_CONFIG must have at least one entry");
  }

  const sum = entries.reduce((acc, e) => acc + e.probability, 0);
  if (sum > 1 + 1e-9) {
    throw new StackAssertionError(`Probabilities sum to ${sum}, which exceeds 1`);
  }

  return entries;
}

let cachedEntries: ReturnType<typeof parseAndValidateConfig> | undefined;
function getCachedConfig() {
  if (!cachedEntries) {
    const rawEnv = getEnvVariable("STACK_BACKEND_URLS_CONFIG", "");
    if (rawEnv) {
      let parsed;
      try {
        parsed = JSON.parse(rawEnv);
      } catch (e) {
        throw new StackAssertionError(`STACK_BACKEND_URLS_CONFIG is not valid JSON: ${e}`);
      }
      cachedEntries = parseAndValidateConfig(parsed);
    } else {
      cachedEntries = [{ probability: 1, urls: getDefaultApiUrls(getEnvVariable("NEXT_PUBLIC_STACK_API_URL")) }];
    }
  }
  return cachedEntries;
}

export const GET = createSmartRouteHandler({
  metadata: {
    hidden: true,
    summary: "Get backend URLs",
    description: "Returns a prioritized list of backend API URLs for client-side failover",
    tags: ["Internal"],
  },
  request: yupObject({
    method: yupString().oneOf(["GET"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      urls: yupArray(yupString().defined()).defined(),
    }).defined(),
  }),
  handler: async () => {
    const entries = getCachedConfig();

    const roll = Math.random();
    let cumulative = 0;
    for (const entry of entries) {
      cumulative += entry.probability;
      if (roll < cumulative) {
        return {
          statusCode: 200,
          bodyType: "json",
          body: { urls: entry.urls },
        } as const;
      }
    }

    return {
      statusCode: 200,
      bodyType: "json",
      body: { urls: entries[entries.length - 1].urls },
    } as const;
  },
});
