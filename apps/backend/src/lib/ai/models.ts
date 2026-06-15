import { isLocalEmulatorEnabled } from "@/lib/local-emulator";
import { getNodeEnvironment } from "@hexclave/shared/dist/utils/env";
import { HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";

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
      authenticated: { modelId: "z-ai/glm-4.5-air:free" },
      unauthenticated: { modelId: "z-ai/glm-4.5-air:free" },
    },
    fast: {
      authenticated: { modelId: "openai/gpt-oss-120b:nitro" },
      unauthenticated: { modelId: "openai/gpt-oss-120b:nitro" },
    },
  },
  smart: {
    slow: {
      authenticated: { modelId: "x-ai/grok-build-0.1" },
      unauthenticated: { modelId: "deepseek/deepseek-v4-flash" },
    },
    fast: {
      authenticated: { modelId: "x-ai/grok-build-0.1" },
      unauthenticated: { modelId: "nvidia/nemotron-3-super-120b-a12b:nitro" },
    },
  },
  smartest: {
    slow: {
      authenticated: { modelId: "openai/gpt-5.5" },
      unauthenticated: { modelId: "deepseek/deepseek-v4-flash" },
    },
    fast: {
      authenticated: { modelId: "openai/gpt-5.5" },
      unauthenticated: { modelId: "deepseek/deepseek-v4-flash:nitro" },
    },
  },
};

// All unique model IDs referenced in the selection matrix, plus sonnet as the proxy default
export const ALLOWED_MODEL_IDS: ReadonlySet<string> = new Set([
  "anthropic/claude-sonnet-4.6",
  ...Object.values(MODEL_SELECTION_MATRIX).flatMap(quality =>
    Object.values(quality).flatMap(speed =>
      Object.values(speed).map(config => config.modelId)
    )
  ),
]);

export function createOpenRouterProvider() {
  const baseURL = (getNodeEnvironment() === "development" || isLocalEmulatorEnabled())
    ? "http://localhost:8102/api/latest/integrations/ai-proxy/v1"
    : "https://api.hexclave.com/api/latest/integrations/ai-proxy/v1";
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
