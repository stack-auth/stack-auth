import { isLocalEmulatorEnabled } from "@/lib/local-emulator";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { getNodeEnvironment } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";

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
      authenticated: { modelId: "moonshotai/kimi-k2.6:nitro" },
      unauthenticated: { modelId: "deepseek/deepseek-v4-flash" },
    },
    fast: {
      authenticated: { modelId: "moonshotai/kimi-k2.6:nitro" },
      unauthenticated: { modelId: "deepseek/deepseek-v4-flash:nitro" },
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
  if (!MODEL_QUALITIES.includes(quality)) throw new StackAssertionError("Invalid quality");
  if (!MODEL_SPEEDS.includes(speed)) throw new StackAssertionError("Invalid speed");

  const config =
    MODEL_SELECTION_MATRIX[quality][speed][isAuthenticated ? "authenticated" : "unauthenticated"];

  const openRouter = directApiKey
    ? createDirectOpenRouterProvider(directApiKey)
    : createOpenRouterProvider();
  const model = openRouter(config.modelId);
  return model;
}
