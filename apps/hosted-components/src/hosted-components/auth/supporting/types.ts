export type AuthProject = {
  displayName?: string,
  config: {
    signUpEnabled: boolean,
    credentialEnabled: boolean,
    passkeyEnabled: boolean,
    magicLinkEnabled: boolean,
    oauthProviders: {
      id: string,
      displayName?: string,
      iconUrl?: string,
    }[],
  },
};

export type AuthType = "sign-in" | "sign-up";
