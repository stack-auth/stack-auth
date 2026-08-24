"use client";

import { useCallback, useEffect, useState } from "react";
import type { AdPlatformAccountDeclaration, AdPlatformId } from "./ad-platform-types";

/**
 * Remembers the user's answer to "do you already have an account on this ad platform?" (and, if not,
 * whether they've said they finished creating it).
 *
 * Deliberately localStorage and not the backend. This is purely a convenience so an experienced
 * advertiser doesn't have to read setup steps they don't need, and it must never be treated as a
 * security boundary or as a fact about the account — the real state of the world always comes from
 * the status endpoint. Losing it (new browser, cleared storage) costs the user one click.
 *
 * Keyed by platform as well as project, so answering the question for Meta doesn't silently answer it
 * for Google.
 */

const DECLARATION_KEY_PREFIX = "hexclave.ad-platforms.account-declaration";
const ACKNOWLEDGED_KEY_PREFIX = "hexclave.ad-platforms.assets-acknowledged";

function readLocalStorage(key: string): string | null {
  // Guarded for SSR and for browsers where storage access throws (Safari private mode, blocked
  // third-party contexts). A failure here means "no stored answer", which degrades to showing the
  // question — the safe default.
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalStorage(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Not being able to remember the answer is a lost convenience, not a failure worth surfacing.
  }
}

function isDeclaration(value: string | null): value is AdPlatformAccountDeclaration {
  return value === "has-account" || value === "needs-account" || value === "unanswered";
}

export function useAdPlatformDeclaration(platform: AdPlatformId, projectId: string): {
  declaration: AdPlatformAccountDeclaration,
  setDeclaration: (value: AdPlatformAccountDeclaration) => void,
  assetsAcknowledged: boolean,
  acknowledgeAssets: () => void,
} {
  // Both start at their "nothing stored" value and are populated in an effect rather than in the
  // initial state, so the first client render matches what the server rendered and React doesn't
  // report a hydration mismatch.
  const [declaration, setDeclarationState] = useState<AdPlatformAccountDeclaration>("unanswered");
  const [assetsAcknowledged, setAssetsAcknowledged] = useState(false);

  const declarationKey = `${DECLARATION_KEY_PREFIX}.${platform}.${projectId}`;
  const acknowledgedKey = `${ACKNOWLEDGED_KEY_PREFIX}.${platform}.${projectId}`;

  useEffect(() => {
    const stored = readLocalStorage(declarationKey);
    if (isDeclaration(stored)) setDeclarationState(stored);
    setAssetsAcknowledged(readLocalStorage(acknowledgedKey) === "true");
  }, [declarationKey, acknowledgedKey]);

  const setDeclaration = useCallback((value: AdPlatformAccountDeclaration) => {
    setDeclarationState(value);
    writeLocalStorage(declarationKey, value);
  }, [declarationKey]);

  const acknowledgeAssets = useCallback(() => {
    setAssetsAcknowledged(true);
    writeLocalStorage(acknowledgedKey, "true");
  }, [acknowledgedKey]);

  return { declaration, setDeclaration, assetsAcknowledged, acknowledgeAssets };
}
