
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
  getAccessToken(): Promise<{ accessToken: string }>,
  useAccessToken(): { accessToken: string }, // THIS_LINE_PLATFORM react-like
} & Connection;
