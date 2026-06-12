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
  | "cliAuthConfirm"
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

/**
 * The default handler URL target, applied to any key not explicitly set.
 *
 * - `{ type: "handler-component" }` — render the page inside the local `StackHandler` component (current default, may change in the next breaking version).
 * - `{ type: "hosted" }` — redirect to Stack's hosted auth pages.
 */
export type DefaultHandlerUrlTarget = { type: "hosted" | "handler-component" };

/**
 * Configuration for where each auth page/redirect lives.
 *
 * **`default`** — fallback target for every key not set individually:
 *   - `{ type: "handler-component" }` — use the local `StackHandler` (current default, may change in the next breaking version).
 *   - `{ type: "hosted" }` — use Stack's hosted auth pages.
 *
 * **Page keys** (`signIn`, `signUp`, `signOut`, `emailVerification`, `passwordReset`,
 * `forgotPassword`, `oauthCallback`, `magicLinkCallback`, `accountSettings`,
 * `teamInvitation`, `cliAuthConfirm`, `mfa`, `error`, `onboarding`, `handler`):
 *   - A URL string (e.g. `"/my-sign-in"`) — custom path.
 *   - `{ type: "custom", url: "...", version: 0 }` — custom URL with version tracking.
 *   - `{ type: "hosted" }` — Stack's hosted page.
 *   - `{ type: "handler-component" }` — local `StackHandler`.
 *
 * **Redirect keys** (`afterSignIn`, `afterSignUp`, `afterSignOut`, `home`):
 *   - A URL string (e.g. `"/dashboard"`) — where to redirect after the action.
 */
export type HandlerUrlOptions = Partial<HandlerUrls> & { default?: DefaultHandlerUrlTarget };
export type ResolvedHandlerUrls = {
  [K in Exclude<keyof HandlerUrls, "signOut">]: string;
} & {
  /**
   * @deprecated `app.urls.signOut` is not a navigable URL. Navigating to it directly cannot clear
   * your app's own session cookies and strands the user on the hosted domain when hosted auth pages
   * are used. Call `await user.signOut()` instead, which works with every configuration.
   */
  signOut: string;
};

export {
  getCustomPagePrompts,
  getLatestPageVersions,
  type CustomPagePrompt,
  type PageComponentKey,
  type PageVersionEntry,
  type PageVersions
} from "./page-component-versions";
