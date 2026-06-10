import { createFileRoute, useLocation } from '@tanstack/react-router';
import { HexclaveHandler } from '@hexclave/react';
import { HostedAccountSettings } from '../../hosted-components/account-settings/index';

export const Route = createFileRoute('/handler/$')({
  component: HandlerPage,
});

function HandlerPage() {
  const location = useLocation();
  if (location.pathname.endsWith('/handler/account-settings')) {
    return <HostedAccountSettings fullPage />;
  }

  return <HexclaveHandler fullPage />;
}
