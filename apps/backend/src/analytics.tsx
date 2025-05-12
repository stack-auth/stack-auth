import { getEnvVariable } from '@stackframe/stack-shared/dist/utils/env';
import { PostHog } from 'posthog-node';

export default async function withPostHog<T>(callback: (posthog: PostHog) => Promise<T>) {
  const postHogKey = getEnvVariable("NEXT_PUBLIC_POSTHOG_KEY", "phc_vIUFi0HzHo7oV26OsaZbUASqxvs8qOmap1UBYAutU4k");
  const posthogClient = new PostHog(postHogKey, {
    host: "https://eu.i.posthog.com",
    flushAt: 1,
    flushInterval: 0
  });
  try {
    await callback(posthogClient);
  } finally {
    await posthogClient.shutdown();
  }
}
