'use client';

import posthog from 'posthog-js';
import { PostHogProvider } from 'posthog-js/react';
import { useEffect } from 'react';

export function CSPostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const postHogKey = "phc_vIUFi0HzHo7oV26OsaZbUASqxvs8qOmap1UBYAutU4k";
      if (postHogKey.length > 5) {
        posthog.init(postHogKey, {
          api_host: "/consume",
          ui_host: "https://eu.i.posthog.com",
          capture_pageview: false,
          capture_pageleave: true,
          person_profiles: 'identified_only'
        });
      }
    }
  }, []);

  return <PostHogProvider client={posthog}>{children}</PostHogProvider>;
}
