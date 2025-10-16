"use client";

import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { stackAppInternalsSymbol, useUser } from "@stackframe/stack";
import { previewTemplateSource } from "@stackframe/stack-shared/dist/helpers/emails";
import { createCachedRegex } from "@stackframe/stack-shared/dist/utils/regex";
import { useEffect, useState } from "react";
import { HookPrefetcher } from "./hook-prefetcher";

const urlPrefetchers: Record<string, ((match: RegExpMatchArray, query: URLSearchParams, hash: string) => void)[]> = {
  "/projects/*": [
    ([_, projectId]) => (useAdminApp(projectId) as any)[stackAppInternalsSymbol].useMetrics(false),
  ],
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
  "/projects/*/users/*": [
    ([_, projectId, userId]) => useAdminApp(projectId).useUser(userId),
    ([_, projectId, userId]) => {
      const user = useAdminApp(projectId).useUser(userId);
      user?.useContactChannels();
    },
    ([_, projectId, userId]) => {
      const user = useAdminApp(projectId).useUser(userId);
      user?.useTeams();
    },
    ([_, projectId, userId]) => {
      const user = useAdminApp(projectId).useUser(userId);
      user?.useOAuthProviders();
    },
  ],
  "/projects/*/team-settings": [
    ([_, projectId]) => useAdminApp(projectId).useTeamPermissionDefinitions(),
  ],
  "/projects/*/team-permissions": [
    ([_, projectId]) => useAdminApp(projectId).useTeamPermissionDefinitions(),
    ([_, projectId]) => useAdminApp(projectId).useProjectPermissionDefinitions(),
  ],
  "/projects/*/project-permissions": [
    ([_, projectId]) => useAdminApp(projectId).useProjectPermissionDefinitions(),
    ([_, projectId]) => useAdminApp(projectId).useTeamPermissionDefinitions(),
  ],
  "/projects/*/teams": [
    ([_, projectId]) => useAdminApp(projectId).useTeams(),
  ],
  "/projects/*/teams/*": [
    ([_, projectId]) => useAdminApp(projectId).useTeamPermissionDefinitions(),
    ([_, projectId]) => useAdminApp(projectId).useUsers({ limit: 10 }),
    ([_, projectId, teamId]) => {
      const team = useAdminApp(projectId).useTeam(teamId);
      team?.useUsers();
    },
  ],
  "/projects/*/api-keys": [
    ([_, projectId]) => useAdminApp(projectId).useInternalApiKeys(),
  ],
  "/projects/*/webhooks": [
    ([_, projectId]) => useAdminApp(projectId).useSvixToken(),
  ],
  "/projects/*/webhooks/*": [
    ([_, projectId]) => useAdminApp(projectId).useSvixToken(),
  ],
  "/projects/*/email-drafts": [
    ([_, projectId]) => useAdminApp(projectId).useEmailDrafts(),
  ],
  "/projects/*/email-drafts/*": [
    ([_, projectId]) => useAdminApp(projectId).useEmailDrafts(),
    ([_, projectId]) => useAdminApp(projectId).useEmailThemes(),
    ([_, projectId, draftId]) => {
      const adminApp = useAdminApp(projectId);
      const draft = adminApp.useEmailDrafts().find((d) => d.id === draftId);
      if (draft) {
        adminApp.useEmailPreview({
          themeId: draft.themeId,
          templateTsxSource: draft.tsxSource,
        });
      }
    },
  ],
  "/projects/*/emails": [
    ([_, projectId]) => useAdminApp(projectId).useUsers({ limit: 10 }),
  ],
  "/projects/*/email-templates": [
    ([_, projectId]) => useAdminApp(projectId).useEmailTemplates(),
  ],
  "/projects/*/email-templates/*": [
    ([_, projectId]) => useAdminApp(projectId).useEmailTemplates(),
    ([_, projectId]) => useAdminApp(projectId).useEmailThemes(),
    ([_, projectId, templateId]) => {
      const adminApp = useAdminApp(projectId);
      const template = adminApp.useEmailTemplates().find((t) => t.id === templateId);
      if (template) {
        adminApp.useEmailPreview({
          themeId: template.themeId,
          templateTsxSource: template.tsxSource,
        });
      }
    },
  ],
  "/projects/*/email-themes": [
    ([_, projectId]) => useAdminApp(projectId).useProject().useConfig(),
    ([_, projectId]) => useAdminApp(projectId).useEmailThemes(),
    ([_, projectId]) => {
      const adminApp = useAdminApp(projectId);
      const themes = adminApp.useEmailThemes();
      themes.forEach((theme) => {
        adminApp.useEmailPreview({
          themeId: theme.id,
          templateTsxSource: previewTemplateSource,
        });
      });
    },
  ],
  "/projects/*/email-themes/*": [
    ([_, projectId, themeId]) => useAdminApp(projectId).useEmailTheme(themeId),
    ([_, projectId, themeId]) => {
      const adminApp = useAdminApp(projectId);
      const theme = adminApp.useEmailTheme(themeId);
      adminApp.useEmailPreview({
        themeTsxSource: theme.tsxSource,
        templateTsxSource: previewTemplateSource,
      });
    },
  ],
  "/projects/*/project-settings": [
    ([_, projectId]) => useAdminApp(projectId).useProject(),
    ([_, projectId]) => useAdminApp(projectId).useProject().useProductionModeErrors(),
    () => useUser({ or: "redirect", projectIdMustMatch: "internal" }),
    ([_, projectId]) => {
      const project = useAdminApp(projectId).useProject();
      const teams = useUser({ or: "redirect", projectIdMustMatch: "internal" }).useTeams();
      const ownerTeam = teams.find((team) => team.id === project.ownerTeamId);
      ownerTeam?.useUsers();
    },
  ],
  "/projects/*/payments/**": [
    ([_, projectId]) => useAdminApp(projectId).useStripeAccountInfo(),
  ],
  "/projects/*/payments/transactions": [
    ([_, projectId]) => useAdminApp(projectId).useTransactions({ limit: 10 }),
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
    .flatMap(([_, prefetchers, match]) => match ? prefetchers.map((prefetcher) => () => prefetcher(match, url.searchParams, url.hash)) : []);
}

export function UrlPrefetcher(props: { href: string | URL }) {
  const [url, setUrl] = useState<URL | null>(null);
  useEffect(() => {
    setUrl(new URL(props.href.toString(), window.location.href));
  }, [props.href]);

  if (!url) return null;
  return <HookPrefetcher key={url.toString()} callbacks={getMatchingPrefetchers(url)} />;
}
