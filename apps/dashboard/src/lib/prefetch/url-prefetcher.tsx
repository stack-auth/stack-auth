"use client";

import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { stackAppInternalsSymbol, useStackApp, useUser } from "@stackframe/stack";
import { previewTemplateSource } from "@stackframe/stack-shared/dist/helpers/emails";
import { createCachedRegex } from "@stackframe/stack-shared/dist/utils/regex";
import { useEffect, useState } from "react";
import { HookPrefetcher } from "./hook-prefetcher";

const urlPrefetchers: Record<string, ((match: RegExpMatchArray) => void)[]> = {
  "/projects/*": [
    ([_, projectId]) => (useAdminApp(projectId) as any)[stackAppInternalsSymbol].useMetrics(false),
  ],
  "/projects/*/**": [
    ([_, projectId]) => useStackApp().useProject(),
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
    ([_, projectId, userId]) => {
      const adminApp = useAdminApp(projectId);
      const user = adminApp.useUser(userId);
      user?.useContactChannels();
      user?.useTeams();
      user?.useOAuthProviders();
    },
  ],
  "/projects/*/team-settings": [
    ([_, projectId]) => {
      const adminApp = useAdminApp(projectId);
      adminApp.useTeamPermissionDefinitions();
    },
  ],
  "/projects/*/team-permissions": [
    ([_, projectId]) => {
      const adminApp = useAdminApp(projectId);
      adminApp.useTeamPermissionDefinitions();
      adminApp.useProjectPermissionDefinitions();
    },
  ],
  "/projects/*/project-permissions": [
    ([_, projectId]) => {
      const adminApp = useAdminApp(projectId);
      adminApp.useProjectPermissionDefinitions();
      adminApp.useTeamPermissionDefinitions();
    },
  ],
  "/projects/*/teams": [
    ([_, projectId]) => {
      const adminApp = useAdminApp(projectId);
      adminApp.useTeams();
    },
  ],
  "/projects/*/teams/*": [
    ([_, projectId, teamId]) => {
      const adminApp = useAdminApp(projectId);
      adminApp.useTeamPermissionDefinitions();
      adminApp.useUsers({ limit: 10 });
      const team = adminApp.useTeam(teamId);
      team?.useUsers();
    },
  ],
  "/projects/*/api-keys": [
    ([_, projectId]) => {
      const adminApp = useAdminApp(projectId);
      adminApp.useInternalApiKeys();
    },
  ],
  "/projects/*/webhooks": [
    ([_, projectId]) => {
      const adminApp = useAdminApp(projectId);
      adminApp.useSvixToken();
    },
  ],
  "/projects/*/webhooks/*": [
    ([_, projectId]) => {
      const adminApp = useAdminApp(projectId);
      adminApp.useSvixToken();
    },
  ],
  "/projects/*/email-drafts": [
    ([_, projectId]) => {
      const adminApp = useAdminApp(projectId);
      adminApp.useEmailDrafts();
    },
  ],
  "/projects/*/email-drafts/*": [
    ([_, projectId, draftId]) => {
      const adminApp = useAdminApp(projectId);
      const drafts = adminApp.useEmailDrafts();
      adminApp.useEmailThemes();
      const draft = drafts.find((d) => d.id === draftId);
      if (draft) {
        adminApp.useEmailPreview({
          themeId: draft.themeId,
          templateTsxSource: draft.tsxSource,
        });
      }
    },
  ],
  "/projects/*/emails": [
    ([_, projectId]) => {
      const adminApp = useAdminApp(projectId);
      adminApp.useUsers({ limit: 10 });
    },
  ],
  "/projects/*/email-templates": [
    ([_, projectId]) => {
      const adminApp = useAdminApp(projectId);
      adminApp.useEmailTemplates();
    },
  ],
  "/projects/*/email-templates/*": [
    ([_, projectId, templateId]) => {
      const adminApp = useAdminApp(projectId);
      const templates = adminApp.useEmailTemplates();
      adminApp.useEmailThemes();
      const template = templates.find((t) => t.id === templateId);
      if (template) {
        adminApp.useEmailPreview({
          themeId: template.themeId,
          templateTsxSource: template.tsxSource,
        });
      }
    },
  ],
  "/projects/*/email-themes": [
    ([_, projectId]) => {
      const adminApp = useAdminApp(projectId);
      const project = adminApp.useProject();
      const themes = adminApp.useEmailThemes();
      project.useConfig();
      themes.forEach((theme) => {
        adminApp.useEmailPreview({
          themeId: theme.id,
          templateTsxSource: previewTemplateSource,
        });
      });
    },
  ],
  "/projects/*/email-themes/*": [
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
    ([_, projectId]) => {
      const adminApp = useAdminApp(projectId);
      const project = adminApp.useProject();
      project.useProductionModeErrors();
      const user = useUser({ or: "redirect", projectIdMustMatch: "internal" });
      const teams = user.useTeams();
      const ownerTeam = teams.find((team) => team.id === project.ownerTeamId);
      ownerTeam?.useUsers();
    },
  ],
  "/projects/*/payments/**": [
    ([_, projectId]) => {
      const adminApp = useAdminApp(projectId);
      adminApp.useStripeAccountInfo();
    },
  ],
  "/projects/*/payments/transactions": [
    ([_, projectId]) => {
      const adminApp = useAdminApp(projectId);
      adminApp.useTransactions({ limit: 10 });
    },
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
