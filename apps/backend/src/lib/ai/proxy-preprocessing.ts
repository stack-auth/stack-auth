import { SYSTEM_PROMPTS, BASE_PROMPT } from "@/lib/ai/prompts";
import { createInitPrompt } from "@stackframe/stack-shared/dist/helpers/init-prompt";

/**
 * Opaque preprocessing step applied to every parsed request body that
 * flows through the AI proxy. The concrete behavior lives in the
 * private implementation; the fallback is an identity function.
 */
export type AiProxyBodyProcessor = (input: {
  parsedBody: Record<string, unknown>,
  allowedReferences: readonly string[],
}) => Record<string, unknown>;

/**
 * Reference strings the preprocessor may consult when normalizing a
 * request body. Today this is the union of Stack Auth's known system
 * prompts and first-party user-message prompts.
 */
export function collectAllowedProxyReferences(): readonly string[] {
  const systemPrompts = Object.values(SYSTEM_PROMPTS).map((suffix) => `${BASE_PROMPT}\n\n${suffix}`);
  const userPrompts = [createInitPrompt(false), createInitPrompt(true)];
  return [...systemPrompts, ...userPrompts];
}
