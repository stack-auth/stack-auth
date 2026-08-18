"use client";

import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { useCallback, useEffect, useState } from "react";
import type { AdPlatformId, AdPlatformStatus } from "./ad-platform-types";
import { AdPlatformApiError, fetchAdPlatformStatus } from "./ad-platforms-api";

/**
 * Loads a project's ad-platform connection status.
 *
 * A hook rather than a context because exactly one page consumes it; a provider would add indirection
 * without adding a second consumer.
 *
 * The three states are modelled as a discriminated union so the page cannot render a "loaded" branch
 * without a value, or forget the error branch. The current client resolves locally and cannot
 * realistically fail, but the error branch is kept deliberately: reading a real connection means
 * talking to an external platform, where failure is an ordinary outcome that has to be shown rather
 * than an edge case, and deleting the branch now would mean rebuilding every call site later.
 */
export type AdPlatformStatusState =
  | { status: "loading" }
  | { status: "error", message: string }
  | { status: "loaded", value: AdPlatformStatus };

export function useAdPlatformStatus(projectId: string, platform: AdPlatformId): {
  state: AdPlatformStatusState,
  refresh: (options?: { force?: boolean }) => Promise<void>,
} {
  const [state, setState] = useState<AdPlatformStatusState>({ status: "loading" });

  // `force` is accepted and ignored: the real client uses it to bypass its read cache, and the pages
  // already pass it after a connect/disconnect. Keeping the parameter means those call sites don't
  // change when the real client lands.
  const load = useCallback(async (_options: { force?: boolean } = {}) => {
    try {
      const value = await fetchAdPlatformStatus(projectId, platform);
      setState({ status: "loaded", value });
    } catch (error) {
      // Surfaced as a visible alert by the page, never swallowed — a silently empty page would read
      // as "not connected" and prompt the user to reconnect a perfectly good connection.
      setState({
        status: "error",
        message: error instanceof AdPlatformApiError
          ? error.message
          : "We couldn't load your ad platform connection. Please try again.",
      });
    }
  }, [projectId, platform]);

  useEffect(() => {
    setState({ status: "loading" });
    runAsynchronously(load());
  }, [load]);

  return { state, refresh: load };
}
