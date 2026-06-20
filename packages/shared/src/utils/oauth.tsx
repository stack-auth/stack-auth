export const standardProviders = ["google", "github", "microsoft", "spotify", "facebook", "discord", "gitlab", "bitbucket", "linkedin", "apple", "x", "twitch"] as const;
// No more shared providers should be added except for special cases
export const sharedProviders = ["google", "github", "microsoft", "spotify"] as const;
export const allProviders = standardProviders;
export const publishableClientKeyNotNecessarySentinel = "__stack_public_client__";

/**
 * Custom SSO provider types. These let users bring their own identity
 * provider (team plan+ only): "custom_oidc" for OIDC-compliant providers
 * (with discovery) and "custom_oauth" for generic OAuth 2.0 providers
 * (with manually-configured authorize/token/userinfo endpoints).
 */
export const customProviderTypes = ["custom_oidc", "custom_oauth"] as const;
export type CustomProviderType = typeof customProviderTypes[number];

/**
 * Returns true if the given provider type is a custom SSO provider
 * (as opposed to one of the first-class standard providers).
 */
export function isCustomProviderType(type: string | null | undefined): type is CustomProviderType {
  return type != null && (customProviderTypes as readonly string[]).includes(type);
}

/**
 * All provider types including custom SSO. Standard providers are the
 * predefined set with first-class support; the custom types let users bring
 * any OIDC or OAuth 2.0 identity provider (team plan+ only).
 */
export const allProviderTypes = [...standardProviders, ...customProviderTypes] as const;
export type AllProviderType = typeof allProviderTypes[number];

export type ProviderType = typeof allProviders[number];
export type StandardProviderType = typeof standardProviders[number];
export type SharedProviderType = typeof sharedProviders[number];
