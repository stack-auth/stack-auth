/**
 * Opaque preprocessing step applied to every parsed request body that
 * flows through the AI proxy. The concrete behavior lives in the
 * private implementation; the fallback is an identity function.
 */
export type AiProxyBodyProcessor = (input: {
  parsedBody: Record<string, unknown>,
}) => Record<string, unknown>;
