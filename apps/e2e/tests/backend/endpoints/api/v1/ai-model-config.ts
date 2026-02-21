/**
 * Duplicated from apps/backend/src/lib/ai/models.ts for E2E tests. TODO: think about this (its duplicated for now)
 * E2E app cannot import from backend internals. Keep in sync with models.ts.
 */
type ModelQuality = "dumb" | "smart" | "smartest";
type ModelSpeed = "slow" | "fast";

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
      authenticated: {
        modelId: "anthropic/claude-opus-4.6",
        thinking: true,
        extendedOutput: true,
      },
      unauthenticated: { modelId: "x-ai/grok-4.1-fast" },
    },
    fast: {
      authenticated: { modelId: "anthropic/claude-opus-4.6" },
      unauthenticated: { modelId: "x-ai/grok-4.1-fast" },
    },
  },
};
