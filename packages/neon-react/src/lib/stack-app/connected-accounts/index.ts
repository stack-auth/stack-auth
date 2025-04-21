
//===========================================
// THIS FILE IS AUTO-GENERATED FROM TEMPLATE. DO NOT EDIT IT DIRECTLY
//===========================================


export type Connection = {
  id: string,
};

export type OAuthConnection = {
  getAccessToken(): Promise<{ accessToken: string }>,
  useAccessToken(): { accessToken: string }, // THIS_LINE_PLATFORM react-like
} & Connection;
