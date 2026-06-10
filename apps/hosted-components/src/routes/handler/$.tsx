import { createFileRoute, useLocation } from '@tanstack/react-router';
import { HexclaveHandler } from '@hexclave/react';
import { HostedAccountSettings } from '../../hosted-components/account-settings/index';
import {
  HostedEmailVerification,
  HostedForgotPassword,
  HostedPasswordReset,
  HostedSignIn,
  HostedSignUp,
} from '../../hosted-components/auth';

export const Route = createFileRoute('/handler/$')({
  component: HandlerPage,
});

function HandlerPage() {
  const location = useLocation();
  const hostedHandlerPath = getHostedHandlerPath(location.pathname);

  if (hostedHandlerPath === 'account-settings') {
    return <HostedAccountSettings fullPage />;
  }

  if (hostedHandlerPath === 'sign-in' || hostedHandlerPath === 'log-in') {
    return <HostedSignIn fullPage automaticRedirect />;
  }

  if (hostedHandlerPath === 'sign-up' || hostedHandlerPath === 'register') {
    return <HostedSignUp fullPage automaticRedirect />;
  }

  if (hostedHandlerPath === 'forgot-password') {
    return <HostedForgotPassword fullPage />;
  }

  if (hostedHandlerPath === 'password-reset') {
    return <HostedPasswordReset fullPage />;
  }

  if (hostedHandlerPath === 'email-verification') {
    return <HostedEmailVerification fullPage />;
  }

  return <HexclaveHandler fullPage />;
}

function getHostedHandlerPath(pathname: string) {
  const handlerSegment = '/handler/';
  const handlerIndex = pathname.indexOf(handlerSegment);
  if (handlerIndex === -1) {
    return "";
  }

  return pathname.slice(handlerIndex + handlerSegment.length).replace(/^\/+|\/+$/g, "");
}
