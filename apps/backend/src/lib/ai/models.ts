import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";

export type ModelQuality = "dumb" | "smart" | "smartest";
export type ModelSpeed = "slow" | "fast";

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
      authenticated: { modelId: "x-ai/grok-4.1-fast" },
      unauthenticated: { modelId: "x-ai/grok-4.1-fast" },
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

export function createOpenRouterProvider() {
  const apiKey = getEnvVariable("STACK_OPENROUTER_API_KEY");
  return createOpenRouter({ apiKey });
}

export function selectModel(
  quality: ModelQuality,
  speed: ModelSpeed,
  isAuthenticated: boolean
) {
  const config =
    MODEL_SELECTION_MATRIX[quality][speed][isAuthenticated ? "authenticated" : "unauthenticated"];

  const openrouter = createOpenRouterProvider();
  const model = openrouter(config.modelId);
  return model;
}
