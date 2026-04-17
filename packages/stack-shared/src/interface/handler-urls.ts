/**
 * @deprecated Plain string URLs are deprecated. Use `{ type: "custom", url: "...", version: 0 }` instead.
 */
type DeprecatedStringUrl = string;

export type HandlerPageUrls = Record<
  | "handler"
  | "signIn"
  | "signUp"
  | "signOut"
  | "emailVerification"
  | "passwordReset"
  | "forgotPassword"
  | "oauthCallback"
  | "magicLinkCallback"
  | "accountSettings"
  | "teamInvitation"
  | "mfa"
  | "error"
  | "onboarding",
  DeprecatedStringUrl | { type: "custom", url: string, version: number } | { type: "hosted" | "handler-component" }
>;

export type HandlerRedirectUrls = Record<
  | "afterSignIn"
  | "afterSignUp"
  | "afterSignOut"
  | "home",
  string
>;

export type HandlerUrls = HandlerPageUrls & HandlerRedirectUrls;
export type HandlerUrlTarget = HandlerUrls[keyof HandlerUrls];
export type DefaultHandlerUrlTarget = string | { type: "hosted" | "handler-component" };
export type HandlerUrlOptions = Partial<HandlerUrls> & { default?: DefaultHandlerUrlTarget };
export type ResolvedHandlerUrls = {
  [K in keyof HandlerUrls]: string;
};

export {
  getCustomPagePrompts,
  getLatestPageVersions,
  type CustomPagePrompt,
  type PageComponentKey,
  type PageVersionEntry,
  type PageVersions
} from "./page-component-versions";

