import { KnownErrors } from "@stackframe/stack-shared";
import { Result } from "@stackframe/stack-shared/dist/utils/results";

export type Connection = {
  /**
   * @deprecated Use `provider` instead. This field returns the provider for backward compatibility.
   */
  id: string,
  /** Provider config ID (e.g., "google", "github") */
  provider: string,
  /** Account ID from the OAuth provider (e.g., Google user ID) */
  providerAccountId: string,
};

export type OAuthConnection = {
  /**
   * Get an OAuth access token for this connected account.
   *
   * Returns `{ status: "ok", data: { accessToken } }` on success, or
   * `{ status: "error", error: KnownErrors["OAuthAccessTokenNotAvailable"] }` if the
   * refresh token has been revoked/expired or the requested scopes are not available.
   *
   * @param options.scopes - If provided, only returns a token that has all of these scopes.
   */
  getAccessToken(options?: { scopes?: string[] }): Promise<Result<{ accessToken: string }, KnownErrors["OAuthAccessTokenNotAvailable"]>>,
  /**
   * React hook to get an OAuth access token for this connected account.
   *
   * Returns `{ status: "ok", data: { accessToken } }` on success, or
   * `{ status: "error", error: KnownErrors["OAuthAccessTokenNotAvailable"] }` if the
   * refresh token has been revoked/expired or the requested scopes are not available.
   *
   * @param options.scopes - If provided, only returns a token that has all of these scopes.
   */
  useAccessToken(options?: { scopes?: string[] }): Result<{ accessToken: string }, KnownErrors["OAuthAccessTokenNotAvailable"]>, // THIS_LINE_PLATFORM react-like
} & Connection;

/**
 * @deprecated Used by legacy `getConnectedAccount(providerId)`. Use `OAuthConnection` instead,
 * which returns a `Result` from `getAccessToken`/`useAccessToken` instead of throwing.
 */
export type DeprecatedOAuthConnection = {
  getAccessToken(): Promise<{ accessToken: string }>,
  useAccessToken(): { accessToken: string }, // THIS_LINE_PLATFORM react-like
} & Connection;
