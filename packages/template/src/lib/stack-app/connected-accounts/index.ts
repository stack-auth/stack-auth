

export type Connection = {
  id: string,
};

export type OAuthConnection = {
  getAccessToken(): Promise<{ accessToken: string }>,
  // NEXT_LINE_PLATFORM react-like
  useAccessToken(): { accessToken: string },
} & Connection;
