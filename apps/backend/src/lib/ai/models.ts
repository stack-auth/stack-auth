import { getEnvVariable, getNodeEnvironment } from "@hexclave/shared/dist/utils/env";
import { HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { PRODUCTION_AI_PROXY_BASE_URL } from "./proxy-url";

export const MODEL_QUALITIES = ["dumb", "smart", "smartest"] as const;
export const MODEL_SPEEDS = ["slow", "fast"] as const;
export type ModelQuality = typeof MODEL_QUALITIES[number];
export type ModelSpeed = typeof MODEL_SPEEDS[number];

type ModelConfig = {
  modelId: string,
};

const MODEL_SELECTION_MATRIX: Record<
  ModelQuality,
  Record<ModelSpeed, { authenticated: ModelConfig, unauthenticated: ModelConfig }>
> = {
  dumb: {
    slow: {
      authenticated: { modelId: "z-ai/glm-4.5-air" },
      unauthenticated: { modelId: "nvidia/nemotron-3-super-120b-a12b" },
    },
    fast: {
      authenticated: { modelId: "openai/gpt-oss-120b:nitro" },
      unauthenticated: { modelId: "nvidia/nemotron-3-super-120b-a12b:nitro" },
    },
  },
  smart: {
    slow: {
      authenticated: { modelId: "openai/gpt-5.5" },
      unauthenticated: { modelId: "z-ai/glm-5.2:nitro" },
    },
    fast: {
      authenticated: { modelId: "openai/gpt-5.5" },
      unauthenticated: { modelId: "z-ai/glm-5.2:nitro" },
    },
  },
  smartest: {
    slow: {
      authenticated: { modelId: "openai/gpt-5.5" },
      unauthenticated: { modelId: "z-ai/glm-5.2:nitro" },
    },
    fast: {
      authenticated: { modelId: "openai/gpt-5.5" },
      unauthenticated: { modelId: "z-ai/glm-5.2:nitro" },
    },
  },
};

// All unique model IDs referenced in the selection matrix, plus sonnet as the proxy default
export const ALLOWED_MODEL_IDS: ReadonlySet<string> = new Set([
  "anthropic/claude-sonnet-4.6",
  "anthropic/claude-haiku-4.5",
  ...Object.values(MODEL_SELECTION_MATRIX).flatMap(quality =>
    Object.values(quality).flatMap(speed =>
      Object.values(speed).map(config => config.modelId)
    )
  ),
]);

function getDevelopmentAiProxyBaseUrl(): string {
  // Self-call the local AI proxy. Resolution order matters on non-default port
  // prefixes: NEXT_PUBLIC_HEXCLAVE_API_URL is often expanded to :8102 before
  // direnv's prefix is visible, so prefer the origin stashed by instrumentation
  // (and the live port prefix) over that stale URL.
  const stashedOrigin = (globalThis as { __HEXCLAVE_DEV_BACKEND_ORIGIN__?: unknown }).__HEXCLAVE_DEV_BACKEND_ORIGIN__;
  if (typeof stashedOrigin === "string" && stashedOrigin.length > 0) {
    return `${stashedOrigin.replace(/\/$/, "")}/api/latest/integrations/ai-proxy/v1`;
  }
  const prefix = getEnvVariable("NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX", "81");
  const fromPrefix = `http://localhost:${prefix}02`;
  const apiUrl = getEnvVariable("NEXT_PUBLIC_HEXCLAVE_API_URL", "");
  if (apiUrl.length > 0) {
    // Ignore the default-port expansion when our live prefix is not 81.
    const apiLooksLikeDefaultPort = apiUrl.includes(":8102");
    if (!(apiLooksLikeDefaultPort && prefix !== "81")) {
      return `${apiUrl.replace(/\/$/, "")}/api/latest/integrations/ai-proxy/v1`;
    }
  }
  const listenPort = getEnvVariable("PORT", "");
  if (listenPort.length > 0) {
    return `http://localhost:${listenPort}/api/latest/integrations/ai-proxy/v1`;
  }
  return `${fromPrefix}/api/latest/integrations/ai-proxy/v1`;
}

export function createOpenRouterProvider() {
  const baseURL = getNodeEnvironment() === "development"
    ? getDevelopmentAiProxyBaseUrl()
    : `${PRODUCTION_AI_PROXY_BASE_URL}/v1`;
  return createOpenRouter({
    apiKey: "forwarded",
    baseURL,
  });
}

export function createDirectOpenRouterProvider(apiKey: string) {
  return createOpenRouter({ apiKey });
}

export function selectModel(
  quality: ModelQuality,
  speed: ModelSpeed,
  isAuthenticated: boolean,
  directApiKey?: string,
) {
  if (!MODEL_QUALITIES.includes(quality)) throw new HexclaveAssertionError("Invalid quality");
  if (!MODEL_SPEEDS.includes(speed)) throw new HexclaveAssertionError("Invalid speed");

  const config =
    MODEL_SELECTION_MATRIX[quality][speed][isAuthenticated ? "authenticated" : "unauthenticated"];

  const openRouter = directApiKey
    ? createDirectOpenRouterProvider(directApiKey)
    : createOpenRouterProvider();
  const model = openRouter(config.modelId);
  return model;
}
