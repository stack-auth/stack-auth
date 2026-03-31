import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { deindent } from "@stackframe/stack-shared/dist/utils/strings";
import { envVars } from "../env";
import { DefaultHandlerUrlTarget, HandlerPageUrls, HandlerUrlOptions, HandlerUrlTarget, HandlerUrls, ResolvedHandlerUrls } from "./common";

// IF_PLATFORM next
let sdkPackageName = "@stackframe/stack";
// ELSE_IF_PLATFORM react
sdkPackageName = "@stackframe/react";
// ELSE_PLATFORM
sdkPackageName = "@stackframe/js";
// END_PLATFORM

const defaultHostedHandlerDomainSuffix = ".built-with-stack-auth.com";
const hostedHandlerProjectIdPlaceholder = "{projectId}";
const hostedHandlerPathPlaceholder = "{hostedPath}";
const localUrlPlaceholderOrigin = "http://example.com";
const schemePrefixRegex = /^[a-zA-Z][a-zA-Z\d+\-.]*:/;

type CustomPagePrompt = {
  title: string,
  fullPrompt: string,
  versions: Record<number, {
    minSdkVersion: `${number}.${number}.${number}`,
    upgradePrompt: string,
    changelog: string,
  }>,
};

const customPagePrompts: Record<keyof Omit<HandlerPageUrls, "handler">, CustomPagePrompt> = {
  signIn: {
    title: "Sign In",
    fullPrompt: deindent`
      Create a custom sign-in page for my app using Stack Auth. The page should:

      1. Use \`useStackApp()\` and \`useUser()\` from \`${sdkPackageName}\`
      2. If the user is already signed in, show a "you are already signed in" message (don't show the form)
      3. Use \`app.useProject()\` to read the project config and conditionally render auth methods:
         a. If \`project.config.oauthProviders.length > 0\`, render an OAuth button for each provider. Each button calls \`app.signInWithOAuth("<providerId>")\`
         b. If \`project.config.passkeyEnabled\`, show a "Sign in with Passkey" button that calls \`app.signInWithPasskey()\`
         c. If both OAuth/passkey and credential/magic-link methods are enabled, show an "Or continue with" separator between them
         d. If both \`project.config.credentialEnabled\` AND \`project.config.magicLinkEnabled\`, show a tabbed UI with two tabs:
            - "Email" tab: magic link flow (see below)
            - "Email & Password" tab: credential flow (see below)
         e. If only \`project.config.credentialEnabled\`: show the credential form directly (no tabs)
         f. If only \`project.config.magicLinkEnabled\`: show the magic link form directly (no tabs)
         g. If none are enabled, show "No authentication method enabled"
      4. Credential sign-in form:
         - Email input (validated with strict email schema) + Password input
         - "Forgot password?" link pointing to \`app.urls.forgotPassword\`
         - Submit calls \`app.signInWithCredential({ email, password })\`
         - On error, display the error message on the email field
      5. Magic link flow:
         - Email input + "Send email" button
         - Calls \`app.sendMagicLinkEmail(email)\`, returns a nonce
         - After sending, switch to a 6-digit OTP input. User enters the code from their email
         - Submit the OTP + nonce via \`app.signInWithMagicLink(otp + nonce)\`
         - Handle VerificationCodeError and "sign up not enabled" errors
      6. If \`project.config.signUpEnabled\`, show a "Don't have an account? Sign up" link pointing to \`app.urls.signUp\`
      7. Handle loading states on all buttons/forms
    `,
    versions: {},
  },
  signUp: {
    title: "Sign Up",
    fullPrompt: deindent`
      Create a custom sign-up page for my app using Stack Auth. The page should:

      1. Use \`useStackApp()\` and \`useUser()\` from \`${sdkPackageName}\`
      2. If the user is already signed in, show a "you are already signed in" message
      3. If \`project.config.signUpEnabled\` is false, show a "sign up is not enabled" message
      4. Use \`app.useProject()\` to read the project config and conditionally render auth methods:
         a. If \`project.config.oauthProviders.length > 0\`, render an OAuth button for each provider. Each button calls \`app.signInWithOAuth("<providerId>")\`
         b. Note: passkey button is NOT shown on sign-up, only sign-in
         c. If both OAuth and credential/magic-link methods are enabled, show an "Or continue with" separator
         d. If both \`project.config.credentialEnabled\` AND \`project.config.magicLinkEnabled\`, show a tabbed UI:
            - "Email" tab: magic link flow (same as sign-in — calls \`app.sendMagicLinkEmail()\`, then OTP input)
            - "Email & Password" tab: credential sign-up form (see below)
         e. If only \`project.config.credentialEnabled\`: show the credential form directly
         f. If only \`project.config.magicLinkEnabled\`: show the magic link form directly
      5. Credential sign-up form:
         - Email input (strict email validation)
         - Password input (validate with \`getPasswordError()\` for strength requirements)
         - Repeat password input (must match)
         - Submit calls \`app.signUpWithCredential({ email, password })\`
         - On error, display the error message on the email field
      6. Show an "Already have an account? Sign in" link pointing to \`app.urls.signIn\`
      7. Handle loading states on all buttons/forms
    `,
    versions: {
      1: {
        minSdkVersion: "3.0.0",
        upgradePrompt: "Upgrade the custom Sign Up page to version 1. Add support for passkey sign-up when `project.config.passkeyEnabled` is true. Show a 'Sign up with Passkey' button that calls `app.signUpWithPasskey()`. Also add a divider between OAuth/passkey and credential/magic-link sections.",
        changelog: "Added passkey authentication support and improved section dividers between auth methods.",
      },
      2: {
        minSdkVersion: "3.0.0",
        upgradePrompt: "Upgrade the custom Sign Up page to version 2. Add support for passkey sign-up when `project.config.passkeyEnabled` is true. Show a 'Sign up with Passkey' button that calls `app.signUpWithPasskey()`. Also add a divider between OAuth/passkey and credential/magic-link sections.",
        changelog: "Added support for passkey sign-up and improved section dividers between auth methods.",
      },
    },
  },
  signOut: {
    title: "Sign Out",
    fullPrompt: "",
    versions: {},
  },
  emailVerification: {
    title: "Email Verification",
    fullPrompt: deindent`
      Create a custom email verification page for my app using Stack Auth. The page should:

      1. Use \`useStackApp()\` from \`${sdkPackageName}\`
      2. Read the \`code\` from URL search params (e.g. \`searchParams.code\`)
      3. If no code is present, show an "Invalid Verification Link" message
      4. If code is present, show a confirmation screen: "Do you want to verify your email?" with a "Verify" button and a "Cancel" button
         - "Verify" calls \`app.verifyEmail(code)\`
         - "Cancel" calls \`app.redirectToHome()\`
      5. After verification:
         - On success (or if error is VerificationCodeAlreadyUsed): show "Your email has been verified!" with a "Go home" button that calls \`app.redirectToHome()\`
         - On VerificationCodeNotFound error: show "Invalid Verification Link"
         - On VerificationCodeExpired error: show "Expired Verification Link" with a message to request a new one from account settings
    `,
    versions: {},
  },
  passwordReset: {
    title: "Password Reset",
    fullPrompt: deindent`
      Create a custom password reset page for my app using Stack Auth. The page should:

      1. Use \`useStackApp()\` from \`${sdkPackageName}\`
      2. Read the \`code\` from URL search params
      3. If no code is present, show an "Invalid Password Reset Link" message
      4. First, verify the code is valid by calling \`app.verifyPasswordResetCode(code)\`:
         - VerificationCodeNotFound → show "Invalid Password Reset Link"
         - VerificationCodeExpired → show "Expired Password Reset Link" with message to request a new one
         - VerificationCodeAlreadyUsed → show "Used Password Reset Link" message
      5. If code is valid, show the reset form:
         - "New Password" input (validate with \`getPasswordError()\` for strength requirements)
         - "Repeat New Password" input (must match)
         - "Reset Password" submit button
         - Calls \`app.resetPassword({ password, code })\`
      6. On success, show "Your password has been reset" with a link to sign in
      7. On error, show "Failed to reset password" with a message to request a new link
      8. Handle loading states
    `,
    versions: {},
  },
  forgotPassword: {
    title: "Forgot Password",
    fullPrompt: deindent`
      Create a custom forgot password page for my app using Stack Auth. The page should:

      1. Use \`useStackApp()\` and \`useUser()\` from \`${sdkPackageName}\`
      2. If the user is already signed in, show a "you are already signed in" message (don't show the form)
      3. Show a "Reset Your Password" heading with a "Don't need to reset? Sign in" link pointing to \`app.urls.signIn\`
      4. Form contains:
         - Email input (strict email validation)
         - "Send Email" submit button
         - Calls \`app.sendForgotPasswordEmail(email)\`
      5. After successful send, show an "email sent" confirmation message (don't show the form anymore)
      6. Handle loading states
    `,
    versions: {},
  },
  oauthCallback: {
    title: "OAuth Callback",
    fullPrompt: "",
    versions: {},
  },
  magicLinkCallback: {
    title: "Magic Link Callback",
    fullPrompt: "",
    versions: {},
  },
  accountSettings: {
    title: "Account Settings",
    fullPrompt: deindent`
      Create a custom account settings page for my app using Stack Auth. The page should:

      1. Use \`useUser({ or: "redirect" })\` to get the current user (redirects to sign-in if not authenticated) and \`useStackApp()\` from \`${sdkPackageName}\`
      2. Use \`app.useProject()\` to read project config for conditional sections
      3. Use a sidebar layout with these sections:
         a. **My Profile** — display name editing, profile image upload. Use \`user.update()\` to save
         b. **Emails & Auth** — show connected emails, linked OAuth providers (link/unlink), password management, passkey management, MFA (TOTP) setup
         c. **Notifications** — notification preferences
         d. **Active Sessions** — list all sessions with IP/geo info, "current session" indicator, ability to revoke other sessions
         e. **API Keys** (only if \`project.config.allowUserApiKeys\` is true) — list, create, revoke API keys
         f. **Payments** (only if user has products or teams with products via \`user.listProducts()\`) — billing management via \`user.useBilling()\`
         g. **Settings** — sign out button, delete account option
      4. **Teams section** (shown if user has teams or \`project.config.clientTeamCreationEnabled\`):
         - Show a "Teams" divider
         - List each team the user belongs to (via \`user.useTeams()\`) with team icon and display name
         - Each team page shows: team display name, profile image, member list, member invitation, team API keys, leave team option
         - If \`project.config.clientTeamCreationEnabled\`, show a "Create a team" option
      5. Support \`extraItems\` prop to allow adding custom sidebar sections
      6. Wrap each section in Suspense with skeleton fallbacks
    `,
    versions: {},
  },
  teamInvitation: {
    title: "Team Invitation",
    fullPrompt: deindent`
      Create a custom team invitation page for my app using Stack Auth. The page should:

      1. Use \`useStackApp()\` and \`useUser({ includeRestricted: true })\` from \`${sdkPackageName}\`
      2. Read the \`code\` from URL search params
      3. If no code is present, show "Invalid Team Invitation Link"
      4. If user is not signed in, show "Sign in or create an account to join the team" with a "Sign in" button (calls \`app.redirectToSignIn()\`) and a "Cancel" button
      5. If user is restricted (needs onboarding), show "Complete your account setup" with a button to \`app.redirectToOnboarding()\`
      6. Verify the invitation code with \`app.verifyTeamInvitationCode(code)\`:
         - VerificationCodeNotFound → "Invalid Team Invitation Link"
         - VerificationCodeExpired → "Expired Team Invitation Link"
         - VerificationCodeAlreadyUsed → "Used Team Invitation Link"
      7. If valid, fetch team details with \`app.getTeamInvitationDetails(code)\` and show:
         - "You are invited to join [teamDisplayName]"
         - "Join" button → calls \`app.acceptTeamInvitation(code)\`, on success shows confirmation with "Go home" button
         - "Ignore" button → calls \`app.redirectToHome()\`
      8. On accept error, show a generic error message
    `,
    versions: {},
  },
  mfa: {
    title: "MFA",
    fullPrompt: deindent`
      Create a custom MFA (multi-factor authentication) page for my app using Stack Auth. The page should:

      1. Use \`useStackApp()\` from \`${sdkPackageName}\`
      2. On mount, read the MFA attempt code from \`window.sessionStorage.getItem("stack_mfa_attempt_code")\`
      3. Show a "Multi-Factor Authentication" heading with instruction: "Enter the six-digit code from your authenticator app"
      4. Render a 6-digit OTP input (numeric, uppercase)
      5. Auto-submit when all 6 digits are entered:
         - Blur all inputs immediately
         - Call \`app.signInWithMfa(otp, attemptCode, { noRedirect: true })\`
         - On success: clear the attempt code from sessionStorage, show a "Verified! Redirecting..." message with a checkmark, then call \`app.redirectToAfterSignIn()\`
         - On InvalidTotpCode error: show "Invalid TOTP code", clear the OTP input for retry
         - On other errors: show "Verification failed"
      6. While verifying, show a spinner with "Verifying..."
      7. Clear errors when user starts typing again (OTP length > 0 but < 6)
      8. Optionally show a "Cancel" button
    `,
    versions: {},
  },
  error: {
    title: "Error",
    fullPrompt: deindent`
      Create a custom error page for my app using Stack Auth. The page should:

      1. Use \`useStackApp()\` from \`${sdkPackageName}\`
      2. Read \`errorCode\`, \`message\`, and \`details\` from URL search params
      3. If \`errorCode\` or \`message\` is missing, show a generic "Unknown Error" page
      4. Parse the error with \`KnownError.fromJson({ code: errorCode, message, details: JSON.parse(details) })\` from \`@stackframe/stack-shared\`
      5. Handle specific error types with tailored messages:
         - **OAuthConnectionAlreadyConnectedToAnotherUser**: show "This account is already connected to another user" with a "Go Home" button
         - **UserAlreadyConnectedToAnotherOAuthConnection**: show "The user is already connected to another OAuth account" with a "Go Home" button
         - **OAuthProviderAccessDenied**: show "The sign-in operation has been cancelled or denied" with "Sign in again" (→ \`app.redirectToSignIn()\`) and "Go Home" buttons
      6. For all other known errors, show the error message with a "Go Home" button
      7. For unparseable errors, show a generic "Unknown Error" page
    `,
    versions: {},
  },
  onboarding: {
    title: "Onboarding",
    fullPrompt: deindent`
      Create a custom onboarding page for my app using Stack Auth. The page should:

      1. Use \`useUser({ or: "return-null", includeRestricted: true })\` and \`useStackApp()\` from \`${sdkPackageName}\`
      2. Handle three routing cases before showing any form:
         - If user exists and is NOT restricted → they've completed onboarding, redirect with \`app.redirectToAfterSignIn()\`
         - If user is null or anonymous → redirect to \`app.redirectToSignIn()\`
         - If user is restricted → proceed to show onboarding (see below)
      3. Check \`user.restrictedReason.type\` to determine what to show:
         a. If \`"email_not_verified"\` and user has NO primary email (\`!user.primaryEmail\`):
            - Show "Add your email address" form with email input
            - Submit calls \`user.update({ primaryEmail: email })\`
            - Include a "Sign out" button (\`user.signOut()\`)
         b. If \`"email_not_verified"\` and user HAS a primary email:
            - Show "Please check your email inbox" with the email address displayed
            - "Resend verification email" button → calls \`user.sendVerificationEmail()\`
            - "Change" link to switch back to the add-email form
            - "Sign out" button
         c. For any other restricted reason:
            - Show "Complete your account setup" with a generic message and "Sign out" button
    `,
    versions: {},
  },
};

const replaceStackPortPrefix = <T extends string | undefined>(input: T): T => {
  if (!input) return input;
  const prefix = envVars.NEXT_PUBLIC_STACK_PORT_PREFIX;
  return prefix ? input.replace(/\$\{NEXT_PUBLIC_STACK_PORT_PREFIX:-81\}/g, prefix) as T : input;
};

const joinHandlerComponentPath = (basePath: string, pagePath: string): string => {
  const normalizedBasePath = basePath.endsWith("/") && basePath.length > 1
    ? basePath.slice(0, -1)
    : basePath;
  if (pagePath.length === 0) {
    return normalizedBasePath;
  }
  if (normalizedBasePath === "/") {
    return `/${pagePath}`;
  }
  return `${normalizedBasePath}/${pagePath}`;
};

const getHostedPagePathForHandlerName = (handlerName: keyof HandlerUrls): string => {
  switch (handlerName) {
    case "handler": {
      return "";
    }
    case "home": {
      return "";
    }
    case "afterSignIn": {
      return "";
    }
    case "afterSignUp": {
      return "";
    }
    case "afterSignOut": {
      return "";
    }
    case "signIn": {
      return "sign-in";
    }
    case "signUp": {
      return "sign-up";
    }
    case "signOut": {
      return "sign-out";
    }
    case "emailVerification": {
      return "email-verification";
    }
    case "passwordReset": {
      return "password-reset";
    }
    case "forgotPassword": {
      return "forgot-password";
    }
    case "oauthCallback": {
      return "oauth-callback";
    }
    case "magicLinkCallback": {
      return "magic-link-callback";
    }
    case "accountSettings": {
      return "account-settings";
    }
    case "teamInvitation": {
      return "team-invitation";
    }
    case "mfa": {
      return "mfa";
    }
    case "error": {
      return "error";
    }
    case "onboarding": {
      return "onboarding";
    }
  }
};

export const getHostedHandlerDomainSuffix = (): string => {
  const configuredValue = envVars.NEXT_PUBLIC_STACK_HOSTED_HANDLER_DOMAIN_SUFFIX
    ?? defaultHostedHandlerDomainSuffix;
  const domainSuffix = replaceStackPortPrefix(configuredValue);
  if (!domainSuffix.startsWith(".")) {
    throw new StackAssertionError("The hosted handler domain suffix must start with a dot.", {
      domainSuffix,
      hint: "Set NEXT_PUBLIC_STACK_HOSTED_HANDLER_DOMAIN_SUFFIX to a value like '.built-with-stack-auth.com'.",
    });
  }
  return domainSuffix;
};

const getHostedHandlerUrlTemplate = (): string => {
  const configuredTemplate = replaceStackPortPrefix(envVars.NEXT_PUBLIC_STACK_HOSTED_HANDLER_URL_TEMPLATE);
  if (configuredTemplate != null) {
    if (!configuredTemplate.includes(hostedHandlerProjectIdPlaceholder) || !configuredTemplate.includes(hostedHandlerPathPlaceholder)) {
      throw new StackAssertionError("The hosted handler URL template must contain {projectId} and {hostedPath}.", {
        hostedHandlerUrlTemplate: configuredTemplate,
        hint: "Set NEXT_PUBLIC_STACK_HOSTED_HANDLER_URL_TEMPLATE to a value like 'https://{projectId}.built-with-stack-auth.com/{hostedPath}'.",
      });
    }
    return configuredTemplate;
  }
  return `https://${hostedHandlerProjectIdPlaceholder}${getHostedHandlerDomainSuffix()}/${hostedHandlerPathPlaceholder}`;
};

const resolveCustomTargetUrl = (options: {
  target: { type: "custom", url: string, version: number },
  handlerName: keyof HandlerUrls,
}): string => {
  const handlerName = options.handlerName;
  if (handlerName in customPagePrompts) {
    const customPagePrompt = customPagePrompts[handlerName as keyof typeof customPagePrompts];
    if (options.target.version === 0 || options.target.version in customPagePrompt.versions) {
      return options.target.url;
    }

    throw new Error(`Unsupported custom page version ${options.target.version} for ${options.handlerName} page at ${options.target.url}. The latest supported version of this page is ${Math.max(0, ...Object.keys(customPagePrompt.versions).map(Number))}. Please upgrade your Stack Auth SDK to a version that supports this version.`);
  } else {
    throw new Error(`URL target ${options.handlerName} cannot be a custom page. Please specify the URL as a string instead.`);
  }
};

export const getHostedHandlerUrl = (options: { projectId: string, pagePath: string }): string => {
  const normalizedPagePath = options.pagePath.replace(/^\/+/, "");
  const hostedPath = normalizedPagePath.length > 0 ? `handler/${normalizedPagePath}` : "handler";
  const template = getHostedHandlerUrlTemplate();
  const templateFilled = template
    .replaceAll(hostedHandlerProjectIdPlaceholder, options.projectId)
    .replaceAll(hostedHandlerPathPlaceholder, hostedPath);
  return new URL(templateFilled).toString();
};

const isRelativeUrlString = (url: string): boolean => {
  if (url.startsWith("//")) {
    return false;
  }
  return !schemePrefixRegex.test(url);
};

export const isLocalHandlerUrlTarget = (options: {
  targetUrl: string,
  handlerPath: string,
  currentOrigin?: string,
}): boolean => {
  const urlObject = new URL(options.targetUrl, localUrlPlaceholderOrigin);
  const isHandlerPathTarget = urlObject.pathname === options.handlerPath
    || urlObject.pathname.startsWith(`${options.handlerPath}/`);
  if (!isHandlerPathTarget) {
    return false;
  }

  // On server we only have path information, so treat matching handler paths as local.
  if (options.currentOrigin == null) {
    return true;
  }

  return isRelativeUrlString(options.targetUrl) || urlObject.origin === options.currentOrigin;
};

const resolveUrlTarget = (options: {
  target: HandlerUrlTarget,
  fallbackPath: string,
  handlerName: keyof HandlerUrls,
  projectId: string,
}): string => {
  if (typeof options.target === "string") {
    return options.target;
  }

  switch (options.target.type) {
    case "handler-component": {
      return options.fallbackPath;
    }
    case "hosted": {
      return getHostedHandlerUrl({
        projectId: options.projectId,
        pagePath: getHostedPagePathForHandlerName(options.handlerName),
      });
    }
    case "custom": {
      return resolveCustomTargetUrl({
        target: options.target,
        handlerName: options.handlerName,
      });
    }
  }
};

export const resolveHandlerUrls = (options: { urls: HandlerUrlOptions | undefined, projectId: string }): ResolvedHandlerUrls => {
  const configuredUrls = options.urls;
  const defaultTarget: HandlerUrlTarget = configuredUrls?.default ?? { type: "handler-component" };
  let handlerComponentBasePath = "/handler";
  if (typeof configuredUrls?.handler === "string") {
    handlerComponentBasePath = configuredUrls.handler;
  } else if (configuredUrls?.handler != null && configuredUrls.handler.type === "custom") {
    handlerComponentBasePath = resolveCustomTargetUrl({
      target: configuredUrls.handler,
      handlerName: "handler",
    });
  }

  const home = resolveUrlTarget({
    target: configuredUrls?.home ?? defaultTarget,
    fallbackPath: "/",
    handlerName: "home",
    projectId: options.projectId,
  });
  const afterSignIn = resolveUrlTarget({
    target: configuredUrls?.afterSignIn ?? defaultTarget,
    fallbackPath: home,
    handlerName: "afterSignIn",
    projectId: options.projectId,
  });

  return {
    handler: resolveUrlTarget({
      target: configuredUrls?.handler ?? defaultTarget,
      fallbackPath: handlerComponentBasePath,
      handlerName: "handler",
      projectId: options.projectId,
    }),
    signIn: resolveUrlTarget({
      target: configuredUrls?.signIn ?? defaultTarget,
      fallbackPath: joinHandlerComponentPath(handlerComponentBasePath, "sign-in"),
      handlerName: "signIn",
      projectId: options.projectId,
    }),
    signUp: resolveUrlTarget({
      target: configuredUrls?.signUp ?? defaultTarget,
      fallbackPath: joinHandlerComponentPath(handlerComponentBasePath, "sign-up"),
      handlerName: "signUp",
      projectId: options.projectId,
    }),
    afterSignIn,
    afterSignUp: resolveUrlTarget({
      target: configuredUrls?.afterSignUp ?? defaultTarget,
      fallbackPath: afterSignIn,
      handlerName: "afterSignUp",
      projectId: options.projectId,
    }),
    signOut: resolveUrlTarget({
      target: configuredUrls?.signOut ?? defaultTarget,
      fallbackPath: joinHandlerComponentPath(handlerComponentBasePath, "sign-out"),
      handlerName: "signOut",
      projectId: options.projectId,
    }),
    afterSignOut: resolveUrlTarget({
      target: configuredUrls?.afterSignOut ?? defaultTarget,
      fallbackPath: home,
      handlerName: "afterSignOut",
      projectId: options.projectId,
    }),
    emailVerification: resolveUrlTarget({
      target: configuredUrls?.emailVerification ?? defaultTarget,
      fallbackPath: joinHandlerComponentPath(handlerComponentBasePath, "email-verification"),
      handlerName: "emailVerification",
      projectId: options.projectId,
    }),
    passwordReset: resolveUrlTarget({
      target: configuredUrls?.passwordReset ?? defaultTarget,
      fallbackPath: joinHandlerComponentPath(handlerComponentBasePath, "password-reset"),
      handlerName: "passwordReset",
      projectId: options.projectId,
    }),
    forgotPassword: resolveUrlTarget({
      target: configuredUrls?.forgotPassword ?? defaultTarget,
      fallbackPath: joinHandlerComponentPath(handlerComponentBasePath, "forgot-password"),
      handlerName: "forgotPassword",
      projectId: options.projectId,
    }),
    home,
    oauthCallback: resolveUrlTarget({
      target: configuredUrls?.oauthCallback ?? defaultTarget,
      fallbackPath: joinHandlerComponentPath(handlerComponentBasePath, "oauth-callback"),
      handlerName: "oauthCallback",
      projectId: options.projectId,
    }),
    magicLinkCallback: resolveUrlTarget({
      target: configuredUrls?.magicLinkCallback ?? defaultTarget,
      fallbackPath: joinHandlerComponentPath(handlerComponentBasePath, "magic-link-callback"),
      handlerName: "magicLinkCallback",
      projectId: options.projectId,
    }),
    accountSettings: resolveUrlTarget({
      target: configuredUrls?.accountSettings ?? defaultTarget,
      fallbackPath: joinHandlerComponentPath(handlerComponentBasePath, "account-settings"),
      handlerName: "accountSettings",
      projectId: options.projectId,
    }),
    teamInvitation: resolveUrlTarget({
      target: configuredUrls?.teamInvitation ?? defaultTarget,
      fallbackPath: joinHandlerComponentPath(handlerComponentBasePath, "team-invitation"),
      handlerName: "teamInvitation",
      projectId: options.projectId,
    }),
    mfa: resolveUrlTarget({
      target: configuredUrls?.mfa ?? defaultTarget,
      fallbackPath: joinHandlerComponentPath(handlerComponentBasePath, "mfa"),
      handlerName: "mfa",
      projectId: options.projectId,
    }),
    error: resolveUrlTarget({
      target: configuredUrls?.error ?? defaultTarget,
      fallbackPath: joinHandlerComponentPath(handlerComponentBasePath, "error"),
      handlerName: "error",
      projectId: options.projectId,
    }),
    onboarding: resolveUrlTarget({
      target: configuredUrls?.onboarding ?? defaultTarget,
      fallbackPath: joinHandlerComponentPath(handlerComponentBasePath, "onboarding"),
      handlerName: "onboarding",
      projectId: options.projectId,
    }),
  };
};

export const resolveUnknownHandlerPathFallbackUrl = (options: {
  defaultTarget: DefaultHandlerUrlTarget | undefined,
  projectId: string,
  unknownPath: string,
}): string | null => {
  const defaultTarget = options.defaultTarget ?? { type: "handler-component" } satisfies HandlerUrlTarget;
  if (typeof defaultTarget === "string") {
    return defaultTarget;
  }

  switch (defaultTarget.type) {
    case "handler-component": {
      return null;
    }
    case "hosted": {
      return getHostedHandlerUrl({
        projectId: options.projectId,
        pagePath: options.unknownPath,
      });
    }
  }
};

export function getPagePrompt(pageName: string, currentVersion?: number): { title: string; fullPrompt: string; upgradePrompt: string | null; latestVersion: number } | null {
  if (!(pageName in customPagePrompts)) return null;
  const prompt = customPagePrompts[pageName as keyof typeof customPagePrompts];
  const versionKeys = Object.keys(prompt.versions).map(Number);
  const latestVersion = versionKeys.length > 0 ? Math.max(...versionKeys) : 0;

  let upgradePrompt: string | null = null;
  if (currentVersion != null) {
    const relevantVersions = versionKeys
      .filter(v => v > currentVersion)
      .sort((a, b) => a - b);
    const prompts = relevantVersions
      .map(v => prompt.versions[v].upgradePrompt)
      .filter(p => p.length > 0);
    upgradePrompt = prompts.length > 0 ? prompts.join("\n\n") : null;
  } else {
    const upgradeEntry = latestVersion > 0 ? prompt.versions[latestVersion] : undefined;
    upgradePrompt = upgradeEntry?.upgradePrompt ?? null;
  }

  return { title: prompt.title, fullPrompt: prompt.fullPrompt, upgradePrompt, latestVersion };
}

export function getLatestPageVersions(): Record<string, { version: number; changelogs: Record<number, string> }> {
  return Object.fromEntries(
    Object.entries(customPagePrompts).map(([key, prompt]) => {
      const versionKeys = Object.keys(prompt.versions).map(Number);
      const latest = versionKeys.length > 0 ? Math.max(...versionKeys) : 0;
      const changelogs: Record<number, string> = {};
      for (const v of versionKeys) {
        const entry = prompt.versions[v];
        if (entry.changelog) {
          changelogs[v] = entry.changelog;
        }
      }
      return [key, { version: latest, changelogs }];
    })
  );
}

export const isHostedHandlerUrlForProject = (options: { url: string, projectId: string }): boolean => {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(options.url);
  } catch {
    return false;
  }

  const hostedBaseUrl = new URL(getHostedHandlerUrl({ projectId: options.projectId, pagePath: "" }));
  return parsedUrl.origin === hostedBaseUrl.origin
    && (parsedUrl.pathname === hostedBaseUrl.pathname || parsedUrl.pathname.startsWith(`${hostedBaseUrl.pathname}/`));
};
