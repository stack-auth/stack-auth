"use client"; // THIS_LINE_PLATFORM next
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { FilterUndefined, filterUndefined } from "@stackframe/stack-shared/dist/utils/objects";
import { getRelativePart } from "@stackframe/stack-shared/dist/utils/urls";
import { notFound, redirect, RedirectType, usePathname, useSearchParams } from 'next/navigation'; // THIS_LINE_PLATFORM next
import { useMemo } from 'react';
import { SignIn, SignUp, StackServerApp } from "..";
import { useStackApp } from "../lib/hooks";
import { HandlerUrls, StackClientApp } from "../lib/stack-app";
import { AccountSettings } from "./account-settings";
import { CliAuthConfirmation } from "./cli-auth-confirm";
import { EmailVerification } from "./email-verification";
import { ErrorPage } from "./error-page";
import { ForgotPassword } from "./forgot-password";
import { MagicLinkCallback } from "./magic-link-callback";
import { MFA } from "./mfa";
import { OAuthCallback } from "./oauth-callback";
import { PasswordReset } from "./password-reset";
import { SignOut } from "./sign-out";
import { TeamInvitation } from "./team-invitation";

type Components = {
  SignIn: typeof SignIn,
  SignUp: typeof SignUp,
  EmailVerification: typeof EmailVerification,
  PasswordReset: typeof PasswordReset,
  ForgotPassword: typeof ForgotPassword,
  SignOut: typeof SignOut,
  OAuthCallback: typeof OAuthCallback,
  MagicLinkCallback: typeof MagicLinkCallback,
  TeamInvitation: typeof TeamInvitation,
  ErrorPage: typeof ErrorPage,
  AccountSettings: typeof AccountSettings,
  CliAuthConfirmation: typeof CliAuthConfirmation,
  MFA: typeof MFA,
};

type RouteProps = {
  params: Promise<{ stack?: string[] }> | { stack?: string[] },
  searchParams: Promise<Record<string, string>> | Record<string, string>,
};

/**
 * @deprecated The app parameter is no longer necessary. You can safely remove it.
 */
type DeprecatedAppProp = {
  app?: StackClientApp<any> | StackServerApp<any>,
};

/**
 * @deprecated The routeProps parameter is no longer necessary. You can safely remove it.
 */
type DeprecatedRouteProps = {
  routeProps?: RouteProps | unknown,
};

const availablePaths = {
  signIn: 'sign-in',
  signUp: 'sign-up',
  emailVerification: 'email-verification',
  passwordReset: 'password-reset',
  forgotPassword: 'forgot-password',
  signOut: 'sign-out',
  oauthCallback: 'oauth-callback',
  magicLinkCallback: 'magic-link-callback',
  teamInvitation: 'team-invitation',
  accountSettings: 'account-settings',
  cliAuthConfirm: 'cli-auth-confirm',
  mfa: 'mfa',
  error: 'error',
} as const;

const pathAliases = {
  // also includes the uppercase and non-dashed versions
  ...Object.fromEntries(Object.entries(availablePaths).map(([key, value]) => [value, value])),
  "log-in": availablePaths.signIn,
  "register": availablePaths.signUp,
} as const;

type BaseHandlerProps = {
  fullPage: boolean,
  componentProps?: {
    [K in keyof Components]?: Parameters<Components[K]>[0];
  },
};

function renderComponent(props: {
  path: string,
  searchParams: Record<string, string>,
  fullPage: boolean,
  componentProps?: BaseHandlerProps['componentProps'],
  redirectIfNotHandler?: (name: keyof HandlerUrls) => void,
  onNotFound: () => any,
  app: StackClientApp<any> | StackServerApp<any>,
}) {
  const { path, searchParams, fullPage, componentProps, redirectIfNotHandler, onNotFound, app } = props;

  switch (path) {
    case availablePaths.signIn: {
      redirectIfNotHandler?.('signIn');
      return <SignIn
        fullPage={fullPage}
        automaticRedirect
        {...filterUndefinedINU(componentProps?.SignIn)}
      />;
    }
    case availablePaths.signUp: {
      redirectIfNotHandler?.('signUp');
      return <SignUp
        fullPage={fullPage}
        automaticRedirect
        {...filterUndefinedINU(componentProps?.SignUp)}
      />;
    }
    case availablePaths.emailVerification: {
      redirectIfNotHandler?.('emailVerification');
      return <EmailVerification
        searchParams={searchParams}
        fullPage={fullPage}
        {...filterUndefinedINU(componentProps?.EmailVerification)}
      />;
    }
    case availablePaths.passwordReset: {
      redirectIfNotHandler?.('passwordReset');
      return <PasswordReset
        searchParams={searchParams}
        fullPage={fullPage}
        {...filterUndefinedINU(componentProps?.PasswordReset)}
      />;
    }
    case availablePaths.forgotPassword: {
      redirectIfNotHandler?.('forgotPassword');
      return <ForgotPassword
        fullPage={fullPage}
        {...filterUndefinedINU(componentProps?.ForgotPassword)}
      />;
    }
    case availablePaths.signOut: {
      redirectIfNotHandler?.('signOut');
      return <SignOut
        fullPage={fullPage}
        {...filterUndefinedINU(componentProps?.SignOut)}
      />;
    }
    case availablePaths.oauthCallback: {
      redirectIfNotHandler?.('oauthCallback');
      return <OAuthCallback
        fullPage={fullPage}
        {...filterUndefinedINU(componentProps?.OAuthCallback)}
      />;
    }
    case availablePaths.magicLinkCallback: {
      redirectIfNotHandler?.('magicLinkCallback');
      return <MagicLinkCallback
        searchParams={searchParams}
        fullPage={fullPage}
        {...filterUndefinedINU(componentProps?.MagicLinkCallback)}
      />;
    }
    case availablePaths.teamInvitation: {
      redirectIfNotHandler?.('teamInvitation');
      return <TeamInvitation
        searchParams={searchParams}
        fullPage={fullPage}
        {...filterUndefinedINU(componentProps?.TeamInvitation)}
      />;
    }
    case availablePaths.accountSettings: {
      return <AccountSettings
        fullPage={fullPage}
        {...filterUndefinedINU(componentProps?.AccountSettings)}
      />;
    }
    case availablePaths.error: {
      return <ErrorPage
        searchParams={searchParams}
        fullPage={fullPage}
        {...filterUndefinedINU(componentProps?.ErrorPage)}
      />;
    }
    case availablePaths.cliAuthConfirm: {
      return <CliAuthConfirmation
        fullPage={fullPage}
        {...filterUndefinedINU(componentProps?.CliAuthConfirmation)}
      />;
    }
    case availablePaths.mfa: {
      redirectIfNotHandler?.('mfa');
      return <MFA
        fullPage={fullPage}
        {...filterUndefinedINU(componentProps?.MFA)}
      />;
    }
    default: {
      if (Object.values(availablePaths).includes(path as any)) {
        throw new StackAssertionError(`Path alias ${path} not included in switch statement, but in availablePaths?`, { availablePaths });
      }
      for (const [key, value] of Object.entries(pathAliases)) {
        if (path === key.toLowerCase().replaceAll('-', '')) {
          const redirectUrl = `${app.urls.handler}/${value}?${new URLSearchParams(searchParams).toString()}`;
          return { redirect: redirectUrl };
        }
      }
      return onNotFound();
    }
  }
}

function StackHandler<HasTokenStore extends boolean>(props: BaseHandlerProps & Partial<DeprecatedAppProp> & Partial<DeprecatedRouteProps> & Partial<RouteProps> & { location?: string }) {
  // Use hooks to get app
  const stackApp = props.app ?? useStackApp();

  // IF_PLATFORM next
  const pathname = usePathname();
  const searchParamsFromHook = useSearchParams();
  const currentLocation = pathname;
  const searchParamsSource = searchParamsFromHook;
  const origin = 'http://example.com';
  /* ELSE_IF_PLATFORM react
  const currentLocation = props.location ?? window.location.pathname;
  const searchParamsSource = new URLSearchParams(window.location.search);
  const origin = window.location.origin;
  END_PLATFORM */

  const { path, searchParams } = useMemo(() => {
    const handlerPath = new URL(stackApp.urls.handler, origin).pathname;
    const relativePath = currentLocation.startsWith(handlerPath)
      ? currentLocation.slice(handlerPath.length).replace(/^\/+/, '')
      : currentLocation.replace(/^\/+/, '');

    return {
      path: relativePath,
      searchParams: Object.fromEntries(searchParamsSource.entries())
    };
  }, [currentLocation, searchParamsSource, stackApp.urls.handler, origin]);

  const redirectIfNotHandler = (name: keyof HandlerUrls) => {
    const url = stackApp.urls[name];
    const handlerUrl = stackApp.urls.handler;

    if (url !== handlerUrl && url.startsWith(handlerUrl + "/")) {
      return;
    }

    const urlObj = new URL(url, origin);
    for (const [key, value] of Object.entries(searchParams)) {
      urlObj.searchParams.set(key, value);
    }

    // IF_PLATFORM next
    redirect(getRelativePart(urlObj), RedirectType.replace);
    /* ELSE_IF_PLATFORM react
    window.location.href = getRelativePart(urlObj);
    END_PLATFORM */
  };

  const result = renderComponent({
    path,
    searchParams,
    fullPage: props.fullPage,
    componentProps: props.componentProps,
    redirectIfNotHandler,
    onNotFound: () =>
      // IF_PLATFORM next
      notFound()
      /* ELSE_IF_PLATFORM react
      (
        <MessageCard
          title="Page does not exist"
          fullPage={props.fullPage}
          primaryButtonText="Go to Home"
          primaryAction={() => stackApp.redirectToHome()}
        >
          The page you are looking for could not be found. Please check the URL and try again.
        </MessageCard>
      )
      END_PLATFORM */
    ,
    app: stackApp,
  });

  if (result && 'redirect' in result) {
    // IF_PLATFORM next
    redirect(result.redirect, RedirectType.replace);
    /* ELSE_IF_PLATFORM react
    window.location.href = result.redirect;
    return null;
    END_PLATFORM */
  }

  return result;
}

export default StackHandler;

// filter undefined values in object. if object itself is undefined, return undefined
function filterUndefinedINU<T extends {}>(value: T | undefined): FilterUndefined<T> | undefined {
  return value === undefined ? value : filterUndefined(value);
}
