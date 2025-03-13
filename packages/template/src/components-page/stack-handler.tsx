import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { FilterUndefined, filterUndefined, pick } from "@stackframe/stack-shared/dist/utils/objects";
import { getRelativePart } from "@stackframe/stack-shared/dist/utils/urls";
import { RedirectType, notFound, redirect } from 'next/navigation'; // THIS_LINE_PLATFORM next
import { useMemo } from 'react';
import { SignIn, SignUp, StackServerApp } from "..";
import { IframePreventer } from "../components/iframe-preventer";
import { MessageCard } from "../components/message-cards/message-card";
import { HandlerUrls, StackClientApp } from "../lib/stack-app";
import { AccountSettings } from "./account-settings";
import { EmailVerification } from "./email-verification";
import { ErrorPage } from "./error-page";
import { ForgotPassword } from "./forgot-password";
import { MagicLinkCallback } from "./magic-link-callback";
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
};

type RouteProps = {
  params: Promise<{ stack?: string[] }> | { stack?: string[] },
  searchParams: Promise<Record<string, string>> | Record<string, string>,
};

const next15DeprecationWarning = "DEPRECATION WARNING: Next.js 15 disallows spreading the props argument of <StackHandler /> like `{...props}`, so you must now explicitly pass them in the `routeProps` argument: `routeProps={props}`. You can fix this by updating the code in the file `app/handler/[...stack]/route.tsx`.";

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

// IF_PLATFORM next
async function NextStackHandler<HasTokenStore extends boolean>(props: BaseHandlerProps & {
  app: StackServerApp<HasTokenStore>,
} & (
  | Partial<RouteProps>
  | {
    routeProps: RouteProps | unknown,
  }
)): Promise<any> {
  if (!("routeProps" in props)) {
    console.warn(next15DeprecationWarning);
  }

  const routeProps = "routeProps" in props ? props.routeProps as RouteProps : pick(props, ["params", "searchParams"] as any);
  const params = await routeProps.params;
  const searchParams = await routeProps.searchParams;

  if (!params?.stack) {
    return (
      <MessageCard title="Invalid Stack Handler Setup" fullPage={props.fullPage}>
        <p>Can't use {"<StackHandler />"} at this location. Make sure that the file is in a folder called [...stack] and you are passing the routeProps prop.</p>
      </MessageCard>
    );
  }

  const path = params.stack.join('/');

  const redirectIfNotHandler = (name: keyof HandlerUrls) => {
    const url = props.app.urls[name];
    const handlerUrl = props.app.urls.handler;

    if (url !== handlerUrl && url.startsWith(handlerUrl + "/")) {
      return;
    }

    const urlObj = new URL(url, "http://example.com");
    if (searchParams) {
      for (const [key, value] of Object.entries(searchParams)) {
        urlObj.searchParams.set(key, value);
      }
    }

    redirect(getRelativePart(urlObj), RedirectType.replace);
  };

  const result = renderComponent({
    path,
    searchParams: searchParams ?? {},
    fullPage: props.fullPage,
    componentProps: props.componentProps,
    redirectIfNotHandler,
    onNotFound: () => notFound(),
    app: props.app,
  });

  if (result && 'redirect' in result) {
    redirect(result.redirect, RedirectType.replace);
  }

  return <>
    {process.env.NODE_ENV === "development" && !("routeProps" in props) && (
      <span style={{ color: "red" }}>
        {next15DeprecationWarning}. This warning will not be shown in production.
      </span>
    )}
    <IframePreventer>
      {result}
    </IframePreventer>
  </>;
}

// ELSE_IF_PLATFORM react

function ReactStackHandler<HasTokenStore extends boolean>(props: BaseHandlerProps & {
  app: StackClientApp<HasTokenStore>,
  location: string, // Path like "/abc/def"
}) {
  const { path, searchParams } = useMemo(() => {
    // Get search string from window.location since it's not included in currentLocation
    const search = window.location.search;
    const handlerPath = new URL(props.app.urls.handler, window.location.origin).pathname;

    // Remove the handler base path to get the relative path
    const relativePath = props.location.startsWith(handlerPath)
      ? props.location.slice(handlerPath.length).replace(/^\/+/, '')
      : props.location.replace(/^\/+/, '');

    return {
      path: relativePath,
      searchParams: Object.fromEntries(new URLSearchParams(search).entries())
    };
  }, [props.location, props.app.urls.handler]);

  const redirectIfNotHandler = (name: keyof HandlerUrls) => {
    const url = props.app.urls[name];
    const handlerUrl = props.app.urls.handler;

    if (url !== handlerUrl && url.startsWith(handlerUrl + "/")) {
      return;
    }

    const urlObj = new URL(url, window.location.origin);
    for (const [key, value] of Object.entries(searchParams)) {
      urlObj.searchParams.set(key, value);
    }

    window.location.href = getRelativePart(urlObj);
  };

  const result = renderComponent({
    path,
    searchParams,
    fullPage: props.fullPage,
    componentProps: props.componentProps,
    redirectIfNotHandler,
    onNotFound: () => (
      <MessageCard
        title="Page does not exist"
        fullPage={props.fullPage}
        primaryButtonText="Go to Home"
        primaryAction={() => props.app.redirectToHome()}
      >
        The page you are looking for could not be found. Please check the URL and try again.
      </MessageCard>
    ),
    app: props.app,
  });

  if (result && 'redirect' in result) {
    window.location.href = result.redirect;
    return null;
  }

  return (
    <IframePreventer>
      {result}
    </IframePreventer>
  );
}

// END_PLATFORM

// IF_PLATFORM next
export default NextStackHandler;
/* ELSE_IF_PLATFORM react
export default ReactStackHandler;
END_PLATFORM */

function filterUndefinedINU<T extends {}>(value: T | undefined): FilterUndefined<T> | undefined {
  return value === undefined ? value : filterUndefined(value);
}
