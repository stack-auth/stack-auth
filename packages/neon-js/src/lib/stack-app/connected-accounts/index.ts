
//===========================================
// THIS FILE IS AUTO-GENERATED FROM TEMPLATE. DO NOT EDIT IT DIRECTLY
//===========================================


export type Connection = {
  id: string,
};

export type OAuthConnection = {
  getAccessToken(): Promise<{ accessToken: string }>,
} & Connection;
