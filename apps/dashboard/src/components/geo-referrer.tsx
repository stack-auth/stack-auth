"use client";

import { useState } from "react";

export function getReferrerHost(referrer: string): string | null {
  if (!referrer) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(referrer) ? referrer : `https://${referrer}`);
    const host = url.hostname.toLowerCase();
    if (!host || !host.includes(".")) return null;
    return host;
  } catch {
    return null;
  }
}

export function ReferrerFavicon({ host }: { host: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <span aria-hidden className="h-4 w-4 shrink-0 rounded-sm bg-foreground/[0.06]" />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32`}
      alt=""
      width={16}
      height={16}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className="h-4 w-4 shrink-0 rounded-sm object-contain"
    />
  );
}

export function CountryFlag({ code }: { code: string }) {
  const [failed, setFailed] = useState(false);
  const lower = code.toLowerCase();
  if (failed || !/^[a-z]{2}$/.test(lower)) {
    return (
      <span aria-hidden className="inline-flex h-4 w-5 shrink-0 items-center justify-center rounded-sm bg-foreground/[0.06] text-[9px] font-semibold tabular-nums text-muted-foreground">
        {code.toUpperCase()}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://flagcdn.com/w40/${lower}.png`}
      srcSet={`https://flagcdn.com/w40/${lower}.png 1x, https://flagcdn.com/w80/${lower}.png 2x`}
      alt=""
      width={20}
      height={15}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className="h-[15px] w-5 shrink-0 rounded-[2px] object-cover ring-1 ring-black/[0.08] dark:ring-white/[0.08]"
    />
  );
}

export function regionName(code: string): string {
  try {
    // Use a fixed locale so server and client render identical region names; the
    // dashboard UI is English-only, and navigator.language would cause hydration
    // mismatches for non-English users.
    const dn = new Intl.DisplayNames(["en"], { type: "region" });
    return dn.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}
