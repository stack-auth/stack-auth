import { posthog } from "posthog-js";

if (typeof window !== 'undefined') {
  const postHogKey = "phc_vIUFi0HzHo7oV26OsaZbUASqxvs8qOmap1UBYAutU4k";
  if (postHogKey.length > 5) {
    posthog.init(postHogKey, {
      api_host: "/consume",
      ui_host: "https://eu.i.posthog.com",
      person_profiles: 'identified_only',
      defaults: '2025-11-30',
    });
  }
}
