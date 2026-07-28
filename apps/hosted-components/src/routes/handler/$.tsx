import { createFileRoute, useLocation } from '@tanstack/react-router';
import { HexclaveHandler } from '@hexclave/react';
import type { ReactNode } from "react";
import { DevelopmentPageNote, type DevelopmentPageKey } from "~/components/development-page-note";
import { HostedAccountSettings } from '../../hosted-components/account-settings/index';
import {
  HostedEmailVerification,
  HostedError,
  HostedForgotPassword,
  HostedMfa,
  HostedPasswordReset,
  HostedSignIn,
  HostedSignUp,
  HostedTeamInvitation,
  HostedCliAuthConfirm,
  HostedOnboarding,
} from '../../hosted-components/auth';

export const Route = createFileRoute('/handler/$')({
  component: HandlerPage,
});

type HostedPage = {
  pageKey: DevelopmentPageKey,
  render: () => ReactNode,
};

const hostedPages = new Map<string, HostedPage>([
  ["account-settings", {
    pageKey: "accountSettings",
    render: () => <HostedAccountSettings fullPage />,
  }],
  ["sign-in", {
    pageKey: "signIn",
    render: () => <HostedSignIn fullPage automaticRedirect />,
  }],
  ["log-in", {
    pageKey: "signIn",
    render: () => <HostedSignIn fullPage automaticRedirect />,
  }],
  ["sign-up", {
    pageKey: "signUp",
    render: () => <HostedSignUp fullPage automaticRedirect />,
  }],
  ["register", {
    pageKey: "signUp",
    render: () => <HostedSignUp fullPage automaticRedirect />,
  }],
  ["forgot-password", {
    pageKey: "forgotPassword",
    render: () => <HostedForgotPassword fullPage />,
  }],
  ["password-reset", {
    pageKey: "passwordReset",
    render: () => <HostedPasswordReset fullPage />,
  }],
  ["email-verification", {
    pageKey: "emailVerification",
    render: () => <HostedEmailVerification fullPage />,
  }],
  ["mfa", {
    pageKey: "mfa",
    render: () => <HostedMfa fullPage />,
  }],
  ["error", {
    pageKey: "error",
    render: () => <HostedError fullPage />,
  }],
  ["team-invitation", {
    pageKey: "teamInvitation",
    render: () => <HostedTeamInvitation fullPage />,
  }],
  ["cli-auth-confirm", {
    pageKey: "cliAuthConfirm",
    render: () => <HostedCliAuthConfirm fullPage />,
  }],
  ["onboarding", {
    pageKey: "onboarding",
    render: () => <HostedOnboarding fullPage />,
  }],
]);

function HandlerPage() {
  const location = useLocation();
  const hostedPage = hostedPages.get(getHostedHandlerPath(location.pathname));

  if (hostedPage == null) {
    return <HexclaveHandler fullPage />;
  }

  return (
    <WithDevelopmentPageNote pageKey={hostedPage.pageKey}>
      {hostedPage.render()}
    </WithDevelopmentPageNote>
  );
}

function WithDevelopmentPageNote(props: {
  pageKey: DevelopmentPageKey,
  children: ReactNode,
}) {
  return (
    <>
      {props.children}
      <DevelopmentPageNote pageKey={props.pageKey} />
    </>
  );
}

function getHostedHandlerPath(pathname: string) {
  const handlerSegment = '/handler/';
  const handlerIndex = pathname.indexOf(handlerSegment);
  if (handlerIndex === -1) {
    return "";
  }

  return pathname.slice(handlerIndex + handlerSegment.length).replace(/^\/+|\/+$/g, "");
}
