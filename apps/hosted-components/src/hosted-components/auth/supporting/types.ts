export type AuthProject = {
  displayName?: string,
  config: {
    signUpEnabled: boolean,
    credentialEnabled: boolean,
    passkeyEnabled: boolean,
    magicLinkEnabled: boolean,
    oauthProviders: {
      id: string,
    }[],
  },
};

export type AuthType = "sign-in" | "sign-up";
