"use client";

import { useRouter } from "@/components/router";
import { useSearchParams } from "next/navigation";
import { posthog } from "posthog-js";
import { useEffect } from "react";

export default function PostHog() {
  const searchParams = useSearchParams();
  const router = useRouter();
  useEffect(() => {
    // Hexclave rebrand: prefer the new query param name, fall back to the legacy one.
    const initIdKey = searchParams.has("hexclave-init-id") ? "hexclave-init-id" : "stack-init-id";
    const distinctId = searchParams.get(initIdKey);
    if (distinctId) {
      posthog.capture('$merge_dangerously',
        {
          alias: distinctId,
        });
      const newSearchParams = new URLSearchParams();
      searchParams.forEach((value, key) => {
        if (key !== "hexclave-init-id" && key !== "stack-init-id") {
          newSearchParams.append(key, value);
        }
      });
      const newUrl = window.location.pathname +
        (newSearchParams.toString() ? `?${newSearchParams.toString()}` : '');
      router.replace(newUrl);
    }
  }, [searchParams, router]);

  return null;
}
