'use client';
import { getPublicEnvVar } from '@/lib/env';
import { useStackApp, useUser } from '@stackframe/stack';
import posthog from 'posthog-js';
import { PostHogProvider } from 'posthog-js/react';
import { Suspense, useEffect, useState } from 'react';

export function CSPostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const postHogKey = getPublicEnvVar('NEXT_PUBLIC_POSTHOG_KEY') ?? "phc_vIUFi0HzHo7oV26OsaZbUASqxvs8qOmap1UBYAutU4k";
      if (postHogKey.length > 5) {
        posthog.init(postHogKey, {
          session_recording: {
            maskAllInputs: false,
            maskInputOptions: {
              password: true,
            },
          },
          api_host: "/consume",
          ui_host: "https://eu.i.posthog.com",
          capture_pageview: false,
          capture_pageleave: true,
        });
      }
    }
  }, []);

  return <PostHogProvider client={posthog}>{children}</PostHogProvider>;
}

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
