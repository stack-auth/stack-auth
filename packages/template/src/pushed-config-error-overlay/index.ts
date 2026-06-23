// IF_PLATFORM js-like

import { captureError } from "@hexclave/shared/dist/utils/errors";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { isLocalhost } from "@hexclave/shared/dist/utils/urls";
import { envVars } from "../generated/env";
import { getInPageUiBaseCSS } from "../in-page-ui/base-styles";
import { canMountIntoDom, getGlobalUiInstance, h, setGlobalUiInstance, setHtml } from "../in-page-ui/dom";
import type { StackClientApp } from "../lib/hexclave-app";

const GLOBAL_INSTANCE_KEY = "__hexclave-pushed-config-error-overlay";
const MINIMIZED_STORAGE_KEY = "hexclave-pushed-config-error-minimized-key";
const REFRESH_INTERVAL_MS = 5_000;
const HEXCLAVE_LOGO_SVG = '<svg width="16" height="16" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="miter"><path d="M 24 4 L 41.32 14 L 41.32 34 L 24 44 L 6.68 34 L 6.68 14 Z"/><path d="M 11 16.87 L 14 15.13 L 14 32.87 L 11 31.13 Z" fill="currentColor" stroke="none"/><path d="M 11 16.87 L 14 15.13 L 14 32.87 L 11 31.13 Z" fill="currentColor" stroke="none" transform="rotate(120 24 24)"/><path d="M 11 16.87 L 14 15.13 L 14 32.87 L 11 31.13 Z" fill="currentColor" stroke="none" transform="rotate(240 24 24)"/></svg>';
const COPY_ICON_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';

type ConfigIssue = {
  kind: "error" | "warning",
  messages: string[],
};

const css = getInPageUiBaseCSS(".hexclave-config-error-overlay") + `
  .hexclave-config-error-overlay .hce-backdrop {
    position: fixed;
    inset: 0;
    z-index: 2147483647;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: rgba(0, 0, 0, 0.46);
    backdrop-filter: blur(6px);
    overflow: auto;
  }

  .hexclave-config-error-overlay .hce-card {
    --hce-status: var(--sdt-error);
    width: min(720px, calc(100vw - 32px));
    max-height: min(640px, calc(100dvh - 48px));
    border: 1px solid color-mix(in srgb, var(--hce-status) 35%, var(--sdt-border));
    border-radius: 18px;
    background: var(--sdt-overlay-bg);
    box-shadow: var(--sdt-shadow);
    backdrop-filter: blur(18px);
    display: flex;
    overflow: hidden;
  }

  .hexclave-config-error-overlay .hce-card-warning {
    --hce-status: var(--sdt-warning);
  }

  .hexclave-config-error-overlay .hce-card-inner {
    padding: 18px;
    width: 100%;
    overflow: auto;
  }

  .hexclave-config-error-overlay .hce-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
  }

  .hexclave-config-error-overlay .hce-title-row {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    min-width: 0;
  }

  .hexclave-config-error-overlay .hce-logo {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    border-radius: 10px;
    background: var(--hce-status);
    color: white;
    box-shadow: 0 10px 30px color-mix(in srgb, var(--hce-status) 32%, transparent);
  }

  .hexclave-config-error-overlay .hce-badge {
    display: inline-flex;
    flex-shrink: 0;
    padding: 2px 6px;
    border-radius: 999px;
    background: var(--hce-status);
    color: white;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .hexclave-config-error-overlay .hce-title {
    color: var(--sdt-text);
    margin-top: 4px;
    font-size: 18px;
    font-weight: 700;
    line-height: 1.25;
  }

  .hexclave-config-error-overlay .hce-actions {
    display: flex;
    gap: 4px;
  }

  .hexclave-config-error-overlay .hce-icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: 1px solid var(--sdt-border);
    border-radius: 8px;
    background: var(--sdt-bg-elevated);
    color: var(--sdt-text-secondary);
    cursor: pointer;
    font: inherit;
    line-height: 1;
    vertical-align: top;
  }

  .hexclave-config-error-overlay .hce-icon-btn svg {
    display: block;
    flex-shrink: 0;
  }

  .hexclave-config-error-overlay .hce-text-btn {
    align-items: center;
    gap: 6px;
    min-height: 28px;
    padding: 0 10px;
    width: auto;
    font-size: 12px;
    line-height: 1;
  }

  .hexclave-config-error-overlay .hce-icon-btn:hover {
    background: var(--sdt-bg-hover);
    color: var(--sdt-text);
  }

  .hexclave-config-error-overlay .hce-body {
    color: var(--sdt-text-secondary);
    font-size: 14px;
    line-height: 1.5;
  }

  .hexclave-config-error-overlay .hce-message-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-top: 14px;
    margin-bottom: 8px;
  }

  .hexclave-config-error-overlay .hce-message-label {
    color: var(--sdt-text);
    font-size: 12px;
    font-weight: 650;
  }

  .hexclave-config-error-overlay .hce-message {
    padding: 12px;
    max-height: min(260px, max(96px, 30dvh));
    overflow: auto;
    border: 1px solid var(--sdt-border-subtle);
    border-radius: 10px;
    background: var(--sdt-bg-subtle);
    color: var(--sdt-text);
    font-family: var(--sdt-font-mono);
    font-size: 12px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .hexclave-config-error-overlay .hce-footer {
    margin-top: 10px;
    color: var(--sdt-text-tertiary);
    font-size: 12px;
  }

  .hexclave-config-error-overlay .hce-pill {
    position: fixed;
    right: 18px;
    bottom: 18px;
    z-index: 2147483647;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px 8px 8px;
    --hce-status: var(--sdt-error);
    border: 1px solid color-mix(in srgb, var(--hce-status) 35%, var(--sdt-border));
    border-radius: 999px;
    background: var(--sdt-overlay-bg);
    box-shadow: var(--sdt-trigger-shadow);
    color: var(--sdt-text);
    cursor: pointer;
    font: inherit;
    backdrop-filter: blur(18px);
  }

  .hexclave-config-error-overlay .hce-pill-warning {
    --hce-status: var(--sdt-warning);
  }

  .hexclave-config-error-overlay .hce-pill-logo {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border-radius: 999px;
    background: var(--hce-status);
    color: white;
  }

  @media (max-height: 520px) {
    .hexclave-config-error-overlay .hce-backdrop {
      align-items: flex-start;
      padding: 12px;
    }

    .hexclave-config-error-overlay .hce-card {
      width: min(720px, calc(100vw - 24px));
      max-height: calc(100dvh - 24px);
    }

    .hexclave-config-error-overlay .hce-card-inner {
      padding: 12px;
    }

    .hexclave-config-error-overlay .hce-header {
      margin-bottom: 8px;
    }

    .hexclave-config-error-overlay .hce-title {
      font-size: 16px;
    }

    .hexclave-config-error-overlay .hce-body {
      font-size: 13px;
    }

    .hexclave-config-error-overlay .hce-message {
      max-height: max(80px, 24dvh);
    }
  }
`;

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
  if (!canMountIntoDom()) {
    return false;
  }

  const nodeEnv = envVars.NODE_ENV;
  if (nodeEnv !== undefined) {
    return nodeEnv === "development";
  }

  try {
    const url = new URL(window.location.href);
    if (url.protocol === "file:") {
      return true;
    }
  } catch {
    return false;
  }
  return isLocalhost(window.location.href);
}

async function copyTextToClipboard(text: string): Promise<void> {
  const clipboard: unknown = Reflect.get(navigator, "clipboard");
  const writeText = clipboard != null && typeof clipboard === "object"
    ? Reflect.get(clipboard, "writeText")
    : null;
  if (typeof writeText === "function") {
    await writeText.call(clipboard, text);
    return;
  }

  const textarea = h("textarea", {
    style: {
      position: "fixed",
      left: "-9999px",
      top: "0",
      opacity: "0",
    },
    readonly: "true",
  }) as HTMLTextAreaElement;
  textarea.value = text;
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) {
    throw new Error("Browser refused to copy the config error message.");
  }
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

  const render = (issue: ConfigIssue | null) => {
    root.replaceChildren(style);
    if (issue == null) {
      lastErrorKey = null;
      minimized = false;
      return;
    }

    const issueMessage = issue.messages.join("\n");
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
      const logoSpan = h("span", { className: "hce-pill-logo" });
      setHtml(logoSpan, HEXCLAVE_LOGO_SVG);
      root.appendChild(h("button", {
        className: issue.kind === "error" ? "hce-pill" : "hce-pill hce-pill-warning",
        type: "button",
        onClick: () => {
          minimized = false;
          storageRemove(MINIMIZED_STORAGE_KEY);
          render(issue);
        },
      },
      logoSpan,
      h("span", null, issue.kind === "error" ? "Config error" : "Config warning")));
      return;
    }

    const logoSpan = h("span", { className: "hce-logo" });
    setHtml(logoSpan, HEXCLAVE_LOGO_SVG);
    const copyButton = h("button", {
      className: "hce-icon-btn hce-text-btn",
      type: "button",
      title: issue.kind === "error" ? "Copy error message" : "Copy warning message",
      "aria-label": issue.kind === "error" ? "Copy config error message" : "Copy config warning message",
      onClick: () => {
        runAsynchronously(async () => {
          await copyTextToClipboard(issueMessage);
          copyButton.textContent = "Copied";
          setTimeout(() => {
            setHtml(copyButton, `${COPY_ICON_SVG}Copy`);
          }, 1500);
        }, {
          noErrorLogging: true,
          onError: (copyError) => {
            captureError("pushed-config-error-overlay-copy", copyError);
            copyButton.textContent = "Copy failed";
            setTimeout(() => {
              setHtml(copyButton, `${COPY_ICON_SVG}Copy`);
            }, 1500);
          },
        });
      },
    });
    setHtml(copyButton, `${COPY_ICON_SVG}Copy`);

    const aiPromptCopyButton = h("button", {
      className: "hce-icon-btn",
      type: "button",
      title: "Copy AI prompt",
      "aria-label": issue.kind === "error" ? "Copy AI prompt for config error" : "Copy AI prompt for config warning",
      onClick: () => {
        runAsynchronously(async () => {
          await copyTextToClipboard(buildConfigIssueAiPrompt(issue));
          aiPromptCopyButton.textContent = "✓";
          setTimeout(() => {
            setHtml(aiPromptCopyButton, COPY_ICON_SVG);
          }, 1500);
        }, {
          noErrorLogging: true,
          onError: (copyError) => {
            captureError("pushed-config-error-overlay-copy-ai-prompt", copyError);
            aiPromptCopyButton.textContent = "!";
            setTimeout(() => {
              setHtml(aiPromptCopyButton, COPY_ICON_SVG);
            }, 1500);
          },
        });
      },
    });
    setHtml(aiPromptCopyButton, COPY_ICON_SVG);

    root.appendChild(h("div", { className: "hce-backdrop" },
      h("div", { className: issue.kind === "error" ? "hce-card" : "hce-card hce-card-warning", role: "alertdialog", "aria-modal": "true", "aria-label": `Hexclave config ${issueLabel}` },
      h("div", { className: "hce-card-inner" },
        h("div", { className: "hce-header" },
          h("div", { className: "hce-title-row" },
            logoSpan,
            h("div", null,
              h("span", { className: "hce-badge" }, `Config ${issueLabel}`),
              h("div", { className: "hce-title" }, issueTitle),
            ),
          ),
          h("div", { className: "hce-actions" },
            aiPromptCopyButton,
            h("button", {
              className: "hce-icon-btn",
              type: "button",
              title: "Minimize",
              "aria-label": issue.kind === "error" ? "Minimize config error" : "Minimize config warning",
              onClick: () => {
                minimized = true;
                storageSet(MINIMIZED_STORAGE_KEY, issueKey);
                render(issue);
              },
            }, "–"),
          ),
        ),
        h("div", { className: "hce-body" },
          bodyText,
          h("div", { className: "hce-message-header" },
            h("div", { className: "hce-message-label" }, issue.kind === "error" ? "Error message" : "Warning message"),
            copyButton,
          ),
          h("div", { className: "hce-message" }, issueMessage),
          h("div", { className: "hce-footer" }, footerText),
        ),
      ),
    )));
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

  refresh();
  const interval = setInterval(refresh, REFRESH_INTERVAL_MS);

  const cleanup = () => {
    disposed = true;
    clearInterval(interval);
    root.remove();
    if (getGlobalUiInstance(GLOBAL_INSTANCE_KEY)?.cleanup === cleanup) {
      setGlobalUiInstance(GLOBAL_INSTANCE_KEY, null);
    }
  };
  setGlobalUiInstance(GLOBAL_INSTANCE_KEY, { cleanup });
  return cleanup;
}

// END_PLATFORM
