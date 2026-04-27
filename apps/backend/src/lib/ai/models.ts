import { isLocalEmulatorEnabled } from "@/lib/local-emulator";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { getNodeEnvironment } from "@stackframe/stack-shared/dist/utils/env";

export const MODEL_QUALITIES = ["dumb", "smart", "smartest"] as const;
export const MODEL_SPEEDS = ["slow", "fast"] as const;
export type ModelQuality = typeof MODEL_QUALITIES[number];
export type ModelSpeed = typeof MODEL_SPEEDS[number];

type ModelConfig = {
  modelId: string,
  thinking?: boolean,
  extendedOutput?: boolean,
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
      unauthenticated: { modelId: "z-ai/glm-4.5-air:free" },
    },
  },
  smart: {
    slow: {
      // authenticated: { modelId: "x-ai/grok-4.1-fast" },
      // unauthenticated: { modelId: "x-ai/grok-4.1-fast" },
      authenticated: { modelId: "anthropic/claude-haiku-4-5" },
      unauthenticated: { modelId: "anthropic/claude-haiku-4-5" },
    },
    fast: {
      authenticated: { modelId: "x-ai/grok-4.1-fast" },
      unauthenticated: { modelId: "x-ai/grok-4.1-fast" },
    },
  },
  smartest: {
    slow: {
      authenticated: { modelId: "anthropic/claude-opus-4.6", thinking: true, extendedOutput: true },
      unauthenticated: { modelId: "x-ai/grok-4.1-fast" },
    },
    fast: {
      authenticated: { modelId: "anthropic/claude-opus-4.6" },
      unauthenticated: { modelId: "x-ai/grok-4.1-fast" },
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
    : "https://api.stack-auth.com/api/latest/integrations/ai-proxy/v1";
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
  const config =
    MODEL_SELECTION_MATRIX[quality][speed][isAuthenticated ? "authenticated" : "unauthenticated"];

  const openrouter = directApiKey
    ? createDirectOpenRouterProvider(directApiKey)
    : createOpenRouterProvider();
  const model = openrouter(config.modelId);
  return model;
}
