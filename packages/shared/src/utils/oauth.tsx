export const standardProviders = ["google", "github", "microsoft", "spotify", "facebook", "discord", "gitlab", "bitbucket", "linkedin", "apple", "x", "twitch"] as const;
// No more shared providers should be added except for special cases
export const sharedProviders = ["google", "github", "microsoft", "spotify"] as const;
export const allProviders = standardProviders;
export const publishableClientKeyNotNecessarySentinel = "__stack_public_client__";

/**
 * All provider types including custom OIDC. Standard providers are the
 * predefined set with first-class support; "custom_oidc" lets users bring
 * any OIDC-compliant identity provider (team plan+ only).
 */
export const allProviderTypes = [...standardProviders, "custom_oidc"] as const;
export type AllProviderType = typeof allProviderTypes[number];

export type ProviderType = typeof allProviders[number];
export type StandardProviderType = typeof standardProviders[number];
export type SharedProviderType = typeof sharedProviders[number];
