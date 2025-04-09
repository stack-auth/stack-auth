"use client";

import { useRouter } from "@/components/router";
import { useSearchParams } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { useEffect } from "react";

export default function PostHog() {
  const posthog = usePostHog();
  const searchParams = useSearchParams();
  const router = useRouter();
  useEffect(() => {
    const distinctId = searchParams.get("stack-init-id");
    if (distinctId) {
      posthog.capture('$merge_dangerously',
        {
          alias: distinctId,
        });
      const newSearchParams = new URLSearchParams();
      searchParams.forEach((value, key) => {
        if (key !== "stack-init-id") {
          newSearchParams.append(key, value);
        }
      });
      const newUrl = window.location.pathname +
        (newSearchParams.toString() ? `?${newSearchParams.toString()}` : '');
      router.replace(newUrl);
    }
  }, [posthog, searchParams, router]);

  return null;
}
