"use client";

import { getPublicEnvVar } from '@/lib/env';
import { runAsynchronously, wait } from "@stackframe/stack-shared/dist/utils/promises";
import { useEffect, useState } from "react";
import packageJson from "../../package.json";

/**
 * A version checking component for self-hosters which displays a banner if the server is out of date.
 */
export function VersionAlerter({ severeOnly }: { severeOnly: boolean }) {
  const [versionCheckResult, setVersionCheckResult] = useState<{ severe: boolean, error: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // IMPORTANT: THIS ENVIRONMENT VARIABLE IS UNDOCUMENTED AND NOT MEANT FOR PRODUCTION USAGE
  // AND YOU SHOULD ALWAYS KEEP STACK AUTH UP TO DATE. WE CAN'T APPLY SECURITY UPDATES IF
  // YOU DON'T UPDATE STACK AUTH REGULARLY.
  const enableNonSevereVersionCheck = getPublicEnvVar('NEXT_PUBLIC_VERSION_ALERTER_SEVERE_ONLY') !== "true";

  useEffect(() => {
    if (window.location.origin === "https://app.stack-auth.com") {
      // save ourselves one request for the managed hosting
      // note: if you're self-hosting and you want to disable the check, set the envvar
      // above so you still get severe alerts
      return;
    }
    let cancelled = false as boolean;
    runAsynchronously(async () => {
      try {
        await wait(1000); // it's fine to be slow, give other API requests priority
        if (cancelled) return;
        const res = await fetch(`https://api.stack-auth.com/api/v1/check-version`, {
          method: "POST",
          body: JSON.stringify({ clientVersion: packageJson.version }),
          headers: {
            "Content-Type": "application/json",
          },
        });
        if (res.status !== 200) {
          throw new Error(`Version check API call failed with status ${res.status}: ${await res.text()}`);
        }
        const data = await res.json();
        // ESLint bug https://typescript-eslint.io/rules/no-unnecessary-condition/#when-not-to-use-it
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (cancelled) return;
        setVersionCheckResult(data.upToDate ? null : data);
      } catch (e) {
        // wait a little bit because the error may have been caused by a page reload
        await wait(5000);
        if (cancelled) return;
        console.error("Error checking version", e);
        setVersionCheckResult({ severe: true, error: `Error checking version, please make sure you're connected to the internet. See the console for more details. \n${e}` });
      }
    });
    return () => {
      cancelled = true;
    };
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
      {versionCheckResult && (enableNonSevereVersionCheck || versionCheckResult.severe) && versionCheckResult.error}
    </div>
  );
}
