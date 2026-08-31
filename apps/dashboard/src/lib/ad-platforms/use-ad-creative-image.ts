"use client";

import { useEffect, useState } from "react";

/**
 * Resolves an AI-generated ad creative image for the review dialog and the created/live panels, which
 * render the ACTUAL image (never just a filename or a prompt string) before a human approves spend
 * against it.
 *
 * NO IMAGE IS AVAILABLE IN THIS BUILD. Ad creative generation and the asset store that holds the
 * bytes land with the ad platform integration, so every call resolves to the "unavailable" branch the
 * callers already render as a graceful placeholder.
 *
 * The hook is kept — rather than deleted and its call sites simplified — because the shape is the
 * part worth preserving: an object URL that the effect revokes on unmount, so restoring the real
 * fetch is a change to this file alone. When it returns, it reads the bytes from an admin-gated route
 * scoped by BOTH action item and asset id (never a bare asset id, which would let any admin read any
 * asset in the project by guessing), and turns them into the object URL below.
 */
export type AdCreativeImageState =
  | { status: "loading" }
  | { status: "error", message: string }
  | { status: "loaded", objectUrl: string };

export function useAdCreativeImage(actionId: string, assetId: string | null): AdCreativeImageState {
  const [state, setState] = useState<AdCreativeImageState>({ status: "loading" });

  useEffect(() => {
    setState({
      status: "error",
      message: assetId == null
        ? "No image has been generated for this ad yet."
        : "Ad image previews aren't available yet.",
    });
  }, [actionId, assetId]);

  return state;
}
