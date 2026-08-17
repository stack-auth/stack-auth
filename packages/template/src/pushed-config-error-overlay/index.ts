// IF_PLATFORM js-like

import { captureError } from "@hexclave/shared/dist/utils/errors";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { isLikelyDevelopmentEnvironment } from "../in-page-ui/dev-environment";
import { canMountIntoDom, getGlobalUiInstance, h, setGlobalUiInstance } from "../in-page-ui/dom";
import { getIssueCardCSS, renderIssueCard, renderIssuePill, trapFocusInIssueCard, type IssueCardFocusTrap } from "../in-page-ui/issue-card";
import type { StackClientApp } from "../lib/hexclave-app";

const GLOBAL_INSTANCE_KEY = "__hexclave-pushed-config-error-overlay";
const MINIMIZED_STORAGE_KEY = "hexclave-pushed-config-error-minimized-key";
const REFRESH_INTERVAL_MS = 5_000;

type ConfigIssue = {
  kind: "error" | "warning",
  messages: string[],
};

const css = getIssueCardCSS(".hexclave-config-error-overlay");

function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage may be unavailable in private or embedded contexts.
  }
}

function storageRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Storage may be unavailable in private or embedded contexts.
  }
}

function shouldMount(): boolean {
  return canMountIntoDom() && isLikelyDevelopmentEnvironment();
}

function buildConfigIssueAiPrompt(issue: ConfigIssue): string {
  const issueLabel = issue.kind === "error" ? "error" : "warning";
  return [
    `Help me fix this Hexclave config ${issueLabel}.`,
    "",
    "Hexclave reminder:",
    `This ${issueLabel} comes from a pushed Hexclave config file. The app may keep running with the synced Hexclave config, but I need to fix the config file mentioned in the message and save it again so Hexclave can sync the config successfully and clear the dialog. Use your web fetch tool to read https://skill.hexclave.com to learn more about Hexclave.`,
    "",
    issue.kind === "error" ? "Error message:" : "Warning message:",
    issue.messages.join("\n"),
    "",
    "Please explain the likely cause, identify the config key or value I should change, and suggest the smallest safe fix.",
  ].join("\n");
}

export function mountPushedConfigErrorOverlay(app: StackClientApp<true>): () => void {
  if (!shouldMount()) {
    return () => {};
  }

  getGlobalUiInstance(GLOBAL_INSTANCE_KEY)?.cleanup();

  const root = h("div", { className: "hexclave-config-error-overlay" });
  const style = h("style", null, css);
  root.appendChild(style);
  document.body.appendChild(root);

  let disposed = false;
  let lastErrorKey: string | null = null;
  let lastConsoleErrorKey: string | null = null;
  let minimized = false;
  // The card element is replaced on every poll, so the trap has to be rebound to the new one each time or it would keep
  // trapping Tab inside the detached card. Focus is only *moved* into the card when a card first appears for an issue;
  // doing it on every render would yank focus out of whatever the developer is doing every few seconds.
  let focusedIssueKey: string | null = null;
  let focusTrap: IssueCardFocusTrap | null = null;
  const releaseFocusIfHeld = () => {
    focusTrap?.release();
    focusTrap = null;
    focusedIssueKey = null;
  };

  const render = (issue: ConfigIssue | null) => {
    root.replaceChildren(style);
    if (issue == null) {
      lastErrorKey = null;
      minimized = false;
      releaseFocusIfHeld();
      return;
    }

    const issueMessage = "Hexclave config " + issue.kind + ": " + issue.messages.join("\n");
    const issueKey = `${app.projectId}:${issue.kind}:${issueMessage}`;
    const issueLabel = issue.kind === "error" ? "error" : "warning";
    const issueTitle = issue.kind === "error"
      ? "Your Hexclave config has been saved, but contains errors"
      : "Your Hexclave config has been saved, but has warnings";
    const bodyText = issue.kind === "error"
      ? "Your app can keep running, but Hexclave is still using the last valid config until this is fixed."
      : "Your app can keep running, but part of your Hexclave config may not behave the way you expect until this is fixed.";
    const footerText = issue.kind === "error"
      ? "Fix the config file mentioned above and save it again. This message will disappear after the config sync succeeds."
      : "Fix the config file mentioned above and save it again. This warning will disappear after Hexclave syncs a config without warnings.";
    if (issueKey !== lastConsoleErrorKey) {
      lastConsoleErrorKey = issueKey;
      const consoleMessage = `[Hexclave] Config ${issueLabel}: ${issueMessage}`;
      if (issue.kind === "error") {
        console.error(consoleMessage);
      } else {
        console.warn(consoleMessage);
      }
    }

    if (issueKey !== lastErrorKey) {
      lastErrorKey = issueKey;
      minimized = storageGet(MINIMIZED_STORAGE_KEY) === issueKey;
    }

    if (minimized) {
      releaseFocusIfHeld();
      root.appendChild(renderIssuePill({
        kind: issue.kind,
        label: issue.kind === "error" ? "Config error" : "Config warning",
        ariaLabel: `Show Hexclave config ${issueLabel}`,
        onClick: () => {
          minimized = false;
          storageRemove(MINIMIZED_STORAGE_KEY);
          render(issue);
        },
      }));
      return;
    }

    root.appendChild(renderIssueCard({
      kind: issue.kind,
      badge: `Config ${issueLabel}`,
      title: issueTitle,
      bodyText,
      messageLabel: issue.kind === "error" ? "Error message" : "Warning message",
      message: issueMessage,
      footerText,
      ariaLabel: `Hexclave config ${issueLabel}`,
      aiPrompt: buildConfigIssueAiPrompt(issue),
      onCopyError: (copyError) => captureError("pushed-config-error-overlay-copy", copyError),
      onCopyAiPromptError: (copyError) => captureError("pushed-config-error-overlay-copy-ai-prompt", copyError),
      onMinimize: () => {
        minimized = true;
        storageSet(MINIMIZED_STORAGE_KEY, issueKey);
        render(issue);
      },
    }));
    const isNewIssue = focusedIssueKey !== issueKey;
    const previouslyFocused = isNewIssue ? undefined : focusTrap?.previouslyFocused ?? null;
    focusTrap?.release({ restoreFocus: isNewIssue });
    focusedIssueKey = issueKey;
    focusTrap = trapFocusInIssueCard(root, { moveFocusIntoCard: isNewIssue, previouslyFocused });
  };

  const refresh = () => {
    if (disposed || !canMountIntoDom()) {
      return;
    }
    runAsynchronously(async () => {
      const project = await app.getProject();
      if (disposed) {
        return;
      }
      render(project.pushedConfigError == null
        ? project.configWarnings.length === 0
          ? null
          : { kind: "warning", messages: project.configWarnings.map((warning) => warning.message) }
        : { kind: "error", messages: [project.pushedConfigError.message] });
    }, {
      noErrorLogging: true,
      onError: (error) => {
        captureError("pushed-config-error-overlay-refresh", error);
      },
    });
  };

  // This is mounted from the base client-app constructor, which also runs
  // before subclass field initializers. Defer the first app call so overridden
  // methods like adminApp.getProject() can safely touch subclass caches.
  queueMicrotask(refresh);
  const interval = setInterval(refresh, REFRESH_INTERVAL_MS);

  const cleanup = () => {
    disposed = true;
    clearInterval(interval);
    releaseFocusIfHeld();
    root.remove();
    if (getGlobalUiInstance(GLOBAL_INSTANCE_KEY)?.cleanup === cleanup) {
      setGlobalUiInstance(GLOBAL_INSTANCE_KEY, null);
    }
  };
  setGlobalUiInstance(GLOBAL_INSTANCE_KEY, { cleanup });
  return cleanup;
}

// END_PLATFORM
