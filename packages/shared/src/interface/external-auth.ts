export const externalAuthProviderIds = [
  "clerk-integration",
  "better-auth-integration",
  "workos-integration",
] as const;

export type ExternalAuthProviderId = typeof externalAuthProviderIds[number];
