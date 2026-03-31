"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useStackApp } from "../../lib/hooks";
import type { HandlerUrlOptions, HandlerUrls, HandlerUrlTarget } from "../../lib/stack-app/common";
import { stackAppInternalsSymbol } from "../../lib/stack-app/common";
import { getPagePrompt } from "../../lib/stack-app/url-targets";
import { resolveApiBaseUrl } from "../dev-tool-context";

// IF_PLATFORM react-like

const PAGE_ENTRIES: { key: keyof HandlerUrls; label: string }[] = [
  { key: "signIn", label: "Sign-in" },
  { key: "signUp", label: "Sign-up" },
  { key: "forgotPassword", label: "Forgot password" },
  { key: "passwordReset", label: "Password reset" },
  { key: "emailVerification", label: "Email verification" },
  { key: "accountSettings", label: "Account settings" },
  { key: "teamInvitation", label: "Team invitation" },
  { key: "mfa", label: "MFA" },
  { key: "onboarding", label: "Onboarding" },
  { key: "error", label: "Error" },
];

type StructuredUrlTarget = Extract<HandlerUrlTarget, { type: string }>;
type PageClassification = "custom" | StructuredUrlTarget["type"];
type PageVersionStatus = "current" | "outdated" | "deprecated" | "loading";

const classificationLabel: Record<PageClassification, string> = {
  "handler-component": "Handler",
  "hosted": "Hosted",
  "custom": "Custom",
};

const classificationBadgeClass: Record<PageClassification, string> = {
  "handler-component": "sdt-pg-badge-handler",
  "hosted": "sdt-pg-badge-hosted",
  "custom": "sdt-pg-badge-custom",
};

const classificationDescription: Record<PageClassification, string> = {
  "handler-component": "This page is rendered by a built-in Stack Auth component. You can redirect to it by calling:",
  "hosted": "This page is hosted on Stack Auth. You can redirect to it by calling:",
  "custom": "This page uses a custom implementation. You can redirect to it by calling:",
};

function getRedirectMethod(key: keyof HandlerUrls): string {
  return `stackApp.redirectTo${key.charAt(0).toUpperCase()}${key.slice(1)}()`;
}

function classifyTarget(target: HandlerUrlTarget): { classification: PageClassification; version: number | null; isLegacyString: boolean } {
  if (typeof target === "string") return { classification: "custom", version: null, isLegacyString: true };
  if (target.type === "custom") return { classification: "custom", version: target.version, isLegacyString: false };
  return { classification: target.type, version: null, isLegacyString: false };
}

function classifyPage(urlOptions: HandlerUrlOptions, key: keyof HandlerUrls): { classification: PageClassification; version: number | null; isLegacyString: boolean } {
  const target = urlOptions[key] ?? urlOptions.default ?? { type: "handler-component" as const };
  return classifyTarget(target);
}

type VersionChangelog = { version: number; changelog: string };

type PageInfo = {
  key: keyof HandlerUrls;
  label: string;
  url: string;
  classification: PageClassification;
  version: number | null;
  isLegacyString: boolean;
  versionStatus: PageVersionStatus;
  versionChangelogs: VersionChangelog[];
};

function buildPromptText(page: PageInfo): string | null {
  const promptData = getPagePrompt(page.key, page.version ?? undefined);
  if (!promptData) return null;

  const showPrompt = page.classification === "handler-component"
    || page.classification === "hosted"
    || page.versionStatus === "outdated";

  if (!showPrompt) return null;

  const lines: string[] = [];

  if (page.versionStatus === "outdated") {
    if (promptData.upgradePrompt) {
      lines.push(promptData.upgradePrompt);
    } else {
      lines.push(`Upgrade the custom ${promptData.title} page from version ${page.version} to version ${promptData.latestVersion}.`);
    }
  } else if (promptData.fullPrompt) {
    lines.push(promptData.fullPrompt);
  } else {
    return null;
  }

  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("Configuration details:");
  lines.push(`- Page key: \`${page.key}\``);
  lines.push(`- Latest version: \`${promptData.latestVersion}\``);
  lines.push(`- Current classification: ${page.classification === "handler-component" ? "handler (built-in SDK component)" : page.classification === "hosted" ? "hosted (Stack Auth hosted domain)" : `custom (version ${page.version})`}`);
  lines.push("");
  lines.push("After implementing, update your StackServerApp (or StackClientApp) URL config:");
  lines.push("```ts");
  lines.push("urls: {");
  lines.push(`  ${page.key}: { type: "custom", url: "<your-route-path>", version: ${promptData.latestVersion} },`);
  lines.push("}");
  lines.push("```");

  return lines.join("\n");
}

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");

  return (
    <button
      className={`sdt-pg-copy-btn ${state === "copied" ? "sdt-pg-copy-btn-ok" : ""}`}
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setState("copied");
          window.setTimeout(() => setState("idle"), 1500);
        }, () => {
          setState("error");
          window.setTimeout(() => setState("idle"), 2000);
        });
      }}
    >
      {state === "copied" ? "\u2713 Copied" : state === "error" ? "Failed" : label ?? "Copy"}
    </button>
  );
}

function navigateToPage(url: string): void {
  const resolved = new URL(url, window.location.origin);
  if (resolved.origin === window.location.origin) {
    window.location.href = resolved.toString();
  } else {
    window.open(resolved.toString(), "_blank", "noopener,noreferrer");
  }
}

function PageDetail({ page }: { page: PageInfo }) {
  const prompt = buildPromptText(page);
  const promptData = getPagePrompt(page.key);
  const isOutdated = page.versionStatus === "outdated" || page.versionStatus === "deprecated";

  return (
    <div className="sdt-pg-detail">
      {/* Header */}
      <div className="sdt-pg-header">
        <div className="sdt-pg-header-top">
          <h3 className="sdt-pg-title">{page.label} Page</h3>
          {isOutdated && <span className="sdt-pg-badge sdt-pg-badge-outdated">Outdated</span>}
          <span className={`sdt-pg-badge ${classificationBadgeClass[page.classification]}`}>
            {classificationLabel[page.classification]}
          </span>
        </div>
        <div className="sdt-pg-subtitle">{classificationDescription[page.classification]}</div>
        <div className="sdt-pg-code-inline">
          <code className="sdt-pg-code">{getRedirectMethod(page.key)}</code>
          <button
            className="sdt-pg-copy-btn"
            type="button"
            onClick={() => navigateToPage(page.url)}
          >
            View
          </button>
        </div>
      </div>

      {/* Update available banner (only for outdated) */}
      {isOutdated && promptData && (
        <div className="sdt-pg-update-banner">
          <div className="sdt-pg-update-banner-icon">{"!"}</div>
          <div className="sdt-pg-update-banner-body">
            <div className="sdt-pg-update-banner-title">Update available</div>
            <div className="sdt-pg-update-banner-text">
              You are currently on <strong>version {page.version}</strong>, but the newest version is <strong>version {promptData.latestVersion}</strong>.
            </div>
          </div>
        </div>
      )}

      {/* Changelog list */}
      {page.versionChangelogs.length > 0 && (
        <div className="sdt-pg-section">
          <div className="sdt-pg-section-label">{isOutdated ? "What's changed" : "Changelog"}</div>
          {page.versionChangelogs.map((vc) => (
            <div key={vc.version} style={{ marginBottom: page.versionChangelogs.length > 1 ? 8 : 0 }}>
              {page.versionChangelogs.length > 1 && (
                <div className="sdt-pg-section-label" style={{ fontSize: 11, opacity: 0.7, marginBottom: 2 }}>
                  Version {vc.version}
                </div>
              )}
              <ul className="sdt-pg-changelog-list">
                {vc.changelog.split(/[.\n]/).filter((s) => s.trim()).map((line, i) => (
                  <li key={i} className="sdt-pg-changelog-item">
                    <span className="sdt-pg-changelog-bullet">{"\u2728"}</span>
                    <span>{line.trim()}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {/* Prompt section */}
      {prompt && (
        <div className="sdt-pg-section">
          <div className="sdt-pg-section-label">{isOutdated ? "Use this prompt to upgrade your component:" : "Customization prompt:"}</div>
          <pre className="sdt-pg-pre">{prompt}</pre>
          <div className="sdt-pg-section-footer">
            <CopyButton text={prompt} label="Copy prompt" />
          </div>
        </div>
      )}

      {/* URL row */}
      <div className="sdt-pg-url-row">
        <span className="sdt-pg-url-label">URL</span>
        <a href={page.url} target="_blank" rel="noopener noreferrer" className="sdt-pg-url">{page.url}</a>
      </div>
    </div>
  );
}

type VersionInfo = { version: number; changelogs: Record<number, string> };

function useLatestPageVersions(apiBaseUrl: string): Partial<Record<string, VersionInfo>> | null {
  const [versions, setVersions] = useState<Partial<Record<string, VersionInfo>> | null>(null);

  useEffect(() => {
    let stale = false;

    fetch(`${apiBaseUrl}/api/latest/internal/component-versions`)
      .then((r) => r.json())
      .then((data) => { if (!stale) setVersions(data.versions); })
      .catch(() => {});

    return () => {
      stale = true;
    };
  }, [apiBaseUrl]);

  return versions;
}

export function ComponentsTab() {
  const app = useStackApp();
  const apiBaseUrl = resolveApiBaseUrl(app);
  const urls = app.urls;
  const urlOptions: HandlerUrlOptions = app[stackAppInternalsSymbol].getConstructorOptions().urls ?? {};
  const [selectedKey, setSelectedKey] = useState<keyof HandlerUrls | null>(null);

  const latestVersions = useLatestPageVersions(apiBaseUrl);

  const pages = useMemo<PageInfo[]>(() =>
    PAGE_ENTRIES.map((entry) => {
      const { classification, version, isLegacyString } = classifyPage(urlOptions, entry.key);

      let versionStatus: PageVersionStatus;
      let versionChangelogs: VersionChangelog[] = [];
      if (isLegacyString) {
        versionStatus = "deprecated";
      } else if (classification === "custom" && version != null) {
        if (latestVersions == null) {
          versionStatus = "loading";
        } else {
          const latestInfo = latestVersions[entry.key];
          if (latestInfo != null && version < latestInfo.version) {
            versionStatus = "outdated";
            versionChangelogs = Object.entries(latestInfo.changelogs)
              .map(([v, cl]) => ({ version: Number(v), changelog: cl }))
              .filter((e) => e.version > version)
              .sort((a, b) => a.version - b.version);
          } else {
            versionStatus = "current";
          }
        }
      } else {
        versionStatus = "current";
      }

      return {
        key: entry.key,
        label: entry.label,
        url: urls[entry.key],
        classification,
        version,
        isLegacyString,
        versionStatus,
        versionChangelogs,
      };
    }),
    [urls, urlOptions, latestVersions]
  );

  const selectedPage = selectedKey
    ? pages.find((p) => p.key === selectedKey) ?? null
    : null;

  const outdatedCount = pages.filter((p) => p.versionStatus === "outdated" || p.versionStatus === "deprecated").length;

  return (
    <div className="sdt-pg-layout">
      <div className="sdt-pg-sidebar">
        <div className="sdt-pg-sidebar-head">
          <span className="sdt-pg-sidebar-title">Pages</span>
          <span className="sdt-pg-sidebar-count">{pages.length}</span>
          {outdatedCount > 0 && (
            <span className="sdt-pg-sidebar-warn">{outdatedCount} outdated</span>
          )}
        </div>
        <div className="sdt-pg-list">
          {pages.map((page) => {
            const isOutdated = page.versionStatus === "outdated" || page.versionStatus === "deprecated";
            return (
              <div
                key={page.key}
                className={`sdt-pg-item ${isOutdated ? "sdt-pg-item-warn" : ""}`}
                data-selected={selectedKey === page.key}
                onClick={() => setSelectedKey(page.key)}
              >
                <span className={`sdt-pg-item-dot ${isOutdated ? "sdt-pg-item-dot-warn" : `sdt-pg-item-dot-${page.classification === "custom" ? "custom" : "handler"}`}`} />
                <span className="sdt-pg-item-label">{page.label}</span>
                {isOutdated ? (
                  <span className="sdt-pg-badge sdt-pg-badge-outdated">Outdated</span>
                ) : (
                  <span className={`sdt-pg-badge ${classificationBadgeClass[page.classification]}`}>
                    {classificationLabel[page.classification]}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="sdt-pg-main">
        {selectedPage ? (
          <PageDetail page={selectedPage} />
        ) : (
          <div className="sdt-pg-empty">
            <div className="sdt-pg-empty-icon">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" />
              </svg>
            </div>
            <div className="sdt-pg-empty-text">Select a page to inspect</div>
            <div className="sdt-pg-empty-sub">View configuration, preview, and upgrade prompts</div>
          </div>
        )}
      </div>
    </div>
  );
}

// END_PLATFORM
