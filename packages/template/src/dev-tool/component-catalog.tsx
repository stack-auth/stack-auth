"use client";

import React from "react";
import { stringCompare } from "@stackframe/stack-shared/dist/utils/strings";
import { AccountSettings } from "../components-page/account-settings";
import { AuthPage } from "../components-page/auth-page";
import { EmailVerification } from "../components-page/email-verification";
import { ForgotPassword } from "../components-page/forgot-password";
import { PasswordReset } from "../components-page/password-reset";
import { SignIn } from "../components-page/sign-in";
import { SignUp } from "../components-page/sign-up";
import { CredentialSignIn } from "../components/credential-sign-in";
import { CredentialSignUp } from "../components/credential-sign-up";
import { MagicLinkSignIn } from "../components/magic-link-sign-in";
import { OAuthButton } from "../components/oauth-button";
import { OAuthButtonGroup } from "../components/oauth-button-group";
import { SelectedTeamSwitcher } from "../components/selected-team-switcher";
import { TeamSwitcher } from "../components/team-switcher";
import { UserButton } from "../components/user-button";

// IF_PLATFORM react-like

/**
 * Catalog entry for a Stack SDK component. The dev tool uses this to:
 * - list every known component (with in-use status)
 * - render live previews
 * - show prop tables
 *
 * Adding a component here is all that's needed — no hooks inside the component.
 */
export type CatalogEntry = {
  /** The actual component function/class */
  component: React.ComponentType<any>;
  /**
   * Optional preview renderer. Defaults to rendering `component` with the
   * detected props. Override when a component needs special handling
   * (e.g. PasswordReset depends on async token verification).
   */
  preview?: 'none' | ((props: Record<string, unknown>) => React.ReactNode);
  /**
   * Extra instructions for generating implementation prompts from the dev tool.
   */
  promptNotes?: readonly string[];
};

/**
 * The single source of truth for every Stack SDK component the dev tool knows
 * about. Keys are display names; values carry the component reference.
 *
 * To register a new component, just add it here.
 */
export const COMPONENT_CATALOG: Record<string, CatalogEntry> = {
  AccountSettings: {
    component: AccountSettings,
    promptNotes: [
      "Use this inside an app that is already wrapped in Stack Auth's provider.",
      "Prefer the built-in Account Settings experience instead of rebuilding profile, sessions, and auth settings manually.",
    ],
  },
  AuthPage: {
    component: AuthPage,
    promptNotes: [
      "Set the `type` prop explicitly to either `sign-in` or `sign-up`.",
      "Keep auth flows delegated to Stack Auth instead of custom form wiring where possible.",
    ],
  },
  CredentialSignIn: { component: CredentialSignIn },
  CredentialSignUp: { component: CredentialSignUp },
  EmailVerification: {
    component: EmailVerification,
    promptNotes: [
      "Use this on a route that can pass the email verification code from URL search params.",
      "Keep the verify/cancel flows handled by Stack Auth.",
    ],
  },
  ForgotPassword: {
    component: ForgotPassword,
    promptNotes: [
      "Use this on a client page and rely on Stack Auth to send the reset email.",
    ],
  },
  MagicLinkSignIn: { component: MagicLinkSignIn },
  OAuthButton: {
    component: OAuthButton,
    promptNotes: [
      "Pass a concrete provider id like `google`, `github`, or another configured OAuth provider.",
      "Use the existing Stack Auth app configuration instead of hardcoding OAuth URLs.",
    ],
  },
  OAuthButtonGroup: {
    component: OAuthButtonGroup,
    promptNotes: [
      "Render this when you want the configured OAuth providers for the current project automatically.",
    ],
  },
  PasswordReset: {
    component: PasswordReset,
    preview: 'none',
    promptNotes: [
      "Use this on a route that can pass the password reset code from URL search params.",
      "Do not reimplement password reset verification manually; let Stack Auth handle it.",
    ],
  },
  SelectedTeamSwitcher: {
    component: SelectedTeamSwitcher,
    promptNotes: [
      "Use this when your app already has a selected team context and you want to switch or clear it.",
    ],
  },
  SignIn: {
    component: SignIn,
    promptNotes: [
      "Use the built-in sign-in page rather than rebuilding the flow by hand.",
    ],
  },
  SignUp: {
    component: SignUp,
    promptNotes: [
      "Use the built-in sign-up page rather than rebuilding the flow by hand.",
    ],
  },
  TeamSwitcher: {
    component: TeamSwitcher,
    promptNotes: [
      "Use this where a signed-in user can switch teams or open team settings.",
    ],
  },
  UserButton: {
    component: UserButton,
    promptNotes: [
      "Use this inside authenticated app chrome, typically in a header or account menu area.",
    ],
  },
};

/** Sorted list of all catalog component names */
export const CATALOG_NAMES: readonly string[] = Object.keys(COMPONENT_CATALOG).sort(
  stringCompare
);

// END_PLATFORM
