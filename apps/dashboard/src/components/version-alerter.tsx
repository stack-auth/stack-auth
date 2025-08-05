"use client";

import { checkVersion, shouldDisplayVersionResult, VersionCheckResult } from '@/lib/version-check';
import { useEffect, useState } from "react";

/**
 * A version checking component for self-hosters which displays a banner if the server is out of date.
 */
export function VersionAlerter() {
  const [versionCheckResult, setVersionCheckResult] = useState<VersionCheckResult>(null);

  useEffect(() => {
    // Note: if you're self-hosting and you want to disable the check, set the envvar
    // NEXT_PUBLIC_VERSION_ALERTER_SEVERE_ONLY so you still get severe alerts
    const cleanup = checkVersion(setVersionCheckResult, {
      delay: 1000, // it's fine to be slow, give other API requests priority
      silentFailure: false, // VersionAlerter should show errors
      errorPrefix: "Error checking version"
    });

    return cleanup;
  }, []);

  return (
    <div style={{
      backgroundColor: versionCheckResult?.severe ? "red" : "orange",
      color: "white",
      fontWeight: "bold",
      textAlign: "center",
      whiteSpace: "pre-wrap",
      maxHeight: "110px",
      overflow: "auto",
      zIndex: 5,
    }}>
      {shouldDisplayVersionResult(versionCheckResult) && versionCheckResult?.error}
    </div>
  );
}
