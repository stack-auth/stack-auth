"use client";

import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { stackAppInternalsSymbol } from "@stackframe/stack";
import { createCachedRegex } from "@stackframe/stack-shared/dist/utils/regex";
import { useEffect, useState } from "react";
import { HookPrefetcher } from "./hook-prefetcher";

const urlPrefetchers: { [Key in `/projects/${string}/${string}`]: ((match: RegExpMatchArray) => void)[] } = {
  "/projects/*/**": [
    ([_, projectId]) => useAdminApp(projectId).useProject().useConfig(),
  ],
  "/projects/*/users": [
    ([_, projectId]) => (useAdminApp(projectId) as any)[stackAppInternalsSymbol].useMetrics(),
    ([_, projectId]) => useAdminApp(projectId).useUsers({ limit: 1 }),
    ([_, projectId]) => useAdminApp(projectId).useUsers({
      limit: 10,
      orderBy: "signedUpAt",
      desc: true,
      includeAnonymous: false,
    }),
  ],
};

function matchPrefetcherPattern(pattern: string, pathname: string) {
  // * should match anything except slashes, at least 1 character; ** should match anything including slashes, can be zero characters
  // any other character should match exactly
  // trailing slashes are ignored
  const regex = createCachedRegex(`^${
      pattern
          .replace(/[-/\\^$+?.()|[\]{}]/g, "\\$&")
          .replace(/\*\*/g, "\u0001")
          .replace(/\*/g, "([^/]+)")
          .replace(/\u0001/g, "(.*)")
          }\/?$`);
  return regex.exec(pathname) || (!pathname.endsWith("/") && regex.exec(`${pathname}/`));
}

function getMatchingPrefetchers(url: URL) {
  if (url.origin !== window.location.origin) return [];
  return Object.entries(urlPrefetchers)
    .map(([pattern, prefetchers]) => [pattern, prefetchers, matchPrefetcherPattern(pattern, url.pathname)] as const)
    .flatMap(([_, prefetchers, match]) => match ? prefetchers.map((prefetcher) => () => prefetcher(match)) : []);
}

export function UrlPrefetcher(props: { href: string | URL }) {
  const [url, setUrl] = useState<URL | null>(null);
  useEffect(() => {
    setUrl(new URL(props.href.toString(), window.location.href));
  }, [props.href]);

  if (!url) return null;
  return <HookPrefetcher key={url.toString()} callbacks={getMatchingPrefetchers(url)} />;
}
