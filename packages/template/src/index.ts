export * from './lib/stack-app';

// IF_PLATFORM react-like
export { default as StackHandler } from "./components-page/stack-handler";
export { useStackApp, useUser } from "./lib/hooks";
export { default as StackProvider } from "./providers/stack-provider";
export { StackTheme } from './providers/theme-provider';

export { AccountSettings } from "./components-page/account-settings";
export { AuthPage } from "./components-page/auth-page";
export { EmailVerification } from "./components-page/email-verification";
export { ForgotPassword } from "./components-page/forgot-password";
export { PasswordReset } from "./components-page/password-reset";
export { SignIn } from "./components-page/sign-in";
export { SignUp } from "./components-page/sign-up";
export { CredentialSignIn as CredentialSignIn } from "./components/credential-sign-in";
export { CredentialSignUp as CredentialSignUp } from "./components/credential-sign-up";
export { UserAvatar } from "./components/elements/user-avatar";
export { MagicLinkSignIn as MagicLinkSignIn } from "./components/magic-link-sign-in";
export { MessageCard } from "./components/message-cards/message-card";
export { OAuthButton } from "./components/oauth-button";
export { OAuthButtonGroup } from "./components/oauth-button-group";
export { SelectedTeamSwitcher } from "./components/selected-team-switcher";
export { UserButton } from "./components/user-button";
export { CliAuthConfirmation } from "./components-page/cli-auth-confirm";
// END_PLATFORM
