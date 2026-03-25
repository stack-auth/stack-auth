'use client';
import { useStackApp, useUser } from '@stackframe/stack';
import posthog from 'posthog-js';
import { Suspense, useEffect, useState } from 'react';

export function UserIdentity() {
  return <Suspense fallback={null}><UserIdentityInner /></Suspense>;
}

function UserIdentityInner() {
  const [lastUserId, setLastUserId] = useState<string | null>(null);
  const app = useStackApp();
  const user = useUser();

  useEffect(() => {
    if (user && user.id !== lastUserId) {
      posthog.identify(user.id, {
        primaryEmail: user.primaryEmail,
        displayName: user.displayName ?? user.primaryEmail ?? user.id,
      });
      posthog.group("projectId", app.projectId);
      setLastUserId(user.id);
    } else if (!user && lastUserId) {
      posthog.reset();
      posthog.resetGroups();
      setLastUserId(null);
    }
  }, [app, user, lastUserId]);
  return null;
}
