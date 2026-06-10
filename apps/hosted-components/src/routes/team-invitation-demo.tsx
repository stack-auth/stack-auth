import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { HostedTeamInvitation } from '../hosted-components/auth';

export const Route = createFileRoute('/team-invitation-demo')({
  component: TeamInvitationDemoPage,
});

function TeamInvitationDemoPage() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('code')) {
      const newUrl = window.location.pathname + '?code=demo-code';
      window.history.replaceState(null, '', newUrl);
    }
    setReady(true);
  }, []);

  if (!ready) {
    return null;
  }

  return <HostedTeamInvitation fullPage />;
}
