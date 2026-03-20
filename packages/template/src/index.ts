export * from './lib/stack-app';
export { getConvexProvidersConfig } from "./integrations/convex";

// IF_PLATFORM react-like
export type { AnalyticsOptions, AnalyticsReplayOptions } from "./lib/stack-app/apps/implementations/session-replay";
export { default as StackHandler } from "./components-page/stack-handler";
export { useStackApp, useUser } from "./lib/hooks";
export { default as StackProvider } from "./providers/stack-provider";
export { StackTheme } from './providers/theme-provider';

import { withDevToolTracking } from "./dev-tool/hooks/use-component-registry";
import { AccountSettings as _AccountSettings } from "./components-page/account-settings";
import { AuthPage as _AuthPage } from "./components-page/auth-page";
import { EmailVerification as _EmailVerification } from "./components-page/email-verification";
import { ForgotPassword as _ForgotPassword } from "./components-page/forgot-password";
import { PasswordReset as _PasswordReset } from "./components-page/password-reset";
import { SignIn as _SignIn } from "./components-page/sign-in";
import { SignUp as _SignUp } from "./components-page/sign-up";
import { CredentialSignIn as _CredentialSignIn } from "./components/credential-sign-in";
import { CredentialSignUp as _CredentialSignUp } from "./components/credential-sign-up";
import { MagicLinkSignIn as _MagicLinkSignIn } from "./components/magic-link-sign-in";
import { OAuthButton as _OAuthButton } from "./components/oauth-button";
import { OAuthButtonGroup as _OAuthButtonGroup } from "./components/oauth-button-group";
import { SelectedTeamSwitcher as _SelectedTeamSwitcher } from "./components/selected-team-switcher";
import { TeamSwitcher as _TeamSwitcher } from "./components/team-switcher";
import { UserButton as _UserButton } from "./components/user-button";

export const AccountSettings = withDevToolTracking("AccountSettings", _AccountSettings);
export const AuthPage = withDevToolTracking("AuthPage", _AuthPage);
export { CliAuthConfirmation } from "./components-page/cli-auth-confirm";
export const EmailVerification = withDevToolTracking("EmailVerification", _EmailVerification);
export const ForgotPassword = withDevToolTracking("ForgotPassword", _ForgotPassword);
export const PasswordReset = withDevToolTracking("PasswordReset", _PasswordReset);
export const SignIn = withDevToolTracking("SignIn", _SignIn);
export const SignUp = withDevToolTracking("SignUp", _SignUp);
export const CredentialSignIn = withDevToolTracking("CredentialSignIn", _CredentialSignIn);
export const CredentialSignUp = withDevToolTracking("CredentialSignUp", _CredentialSignUp);
export { UserAvatar } from "./components/elements/user-avatar";
export const MagicLinkSignIn = withDevToolTracking("MagicLinkSignIn", _MagicLinkSignIn);
export { MessageCard } from "./components/message-cards/message-card";
export const OAuthButton = withDevToolTracking("OAuthButton", _OAuthButton);
export const OAuthButtonGroup = withDevToolTracking("OAuthButtonGroup", _OAuthButtonGroup);
export const SelectedTeamSwitcher = withDevToolTracking("SelectedTeamSwitcher", _SelectedTeamSwitcher);
export const TeamSwitcher = withDevToolTracking("TeamSwitcher", _TeamSwitcher);
export const UserButton = withDevToolTracking("UserButton", _UserButton);
export {
  registerDevToolComponentCatalog,
} from "./dev-tool/hooks/use-component-registry";
export type { DevToolComponentCatalogEntry } from "./dev-tool/hooks/use-component-registry";
// END_PLATFORM
