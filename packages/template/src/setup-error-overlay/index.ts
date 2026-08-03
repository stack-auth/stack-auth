// IF_PLATFORM js-like

// Renders an error card on the page when an auth flow dies because of a setup problem in the developer's project (a
// domain missing from the trusted domains, for example). Those failures used to be logged with captureError only, which
// meant the flow just quietly stopped: the developer saw a page that never signed anybody in, with the explanation
// buried in the console or in Sentry. Setup errors are always the developer's to fix and never recoverable at runtime,
// so they get the same treatment as a broken pushed config: a card that is impossible to miss.

import { HexclaveSetupError, captureError, errorToNiceString } from "@hexclave/shared/dist/utils/errors";
import { isLikelyDevelopmentEnvironment } from "../in-page-ui/dev-environment";
import { canMountIntoDom, getGlobalUiInstance, h, setGlobalUiInstance } from "../in-page-ui/dom";
import { getIssueCardCSS, renderIssueCard, renderIssuePill } from "../in-page-ui/issue-card";

const GLOBAL_INSTANCE_KEY = "__hexclave-setup-error-overlay";

const css = getIssueCardCSS(".hexclave-setup-error-overlay");

const unexpectedErrorHowToFix = [
  "Check the browser console and your Hexclave dashboard's logs for the full error.",
  "Make sure your Hexclave SDK packages are up to date.",
  "If the error looks like a bug in Hexclave, report it at https://github.com/hexclave/hexclave/issues.",
] as const;

type SetupIssue = {
  title: string,
  message: string,
  howToFix: readonly string[],
};

function toSetupIssue(error: unknown): SetupIssue {
  if (HexclaveSetupError.isSetupError(error)) {
    return {
      title: error.title,
      message: error.message,
      howToFix: error.howToFix,
    };
  }
  return {
    title: "Hexclave could not finish an authentication flow",
    message: errorToNiceString(error),
    howToFix: unexpectedErrorHowToFix,
  };
}

function buildAiPrompt(issue: SetupIssue): string {
  return [
    "Help me fix this Hexclave setup error.",
    "",
    "Hexclave reminder:",
    "This error was thrown by the Hexclave SDK in the browser while it was resolving an authentication flow, and the flow was aborted because of it. It is a problem with how my project is set up, not something my users can work around. Use your web fetch tool to read https://skill.hexclave.com to learn more about Hexclave.",
    "",
    "Error message:",
    issue.message,
    "",
    "Hexclave suggests:",
    ...issue.howToFix.map((step) => `- ${step}`),
    "",
    "Please explain the likely cause and suggest the smallest safe fix.",
  ].join("\n");
}

/**
 * Shows `error` as an error card on the current page.
 *
 * Setup errors are always shown, because the flow they aborted cannot complete no matter what the end user does, and
 * their messages are written for exactly this purpose. Any other error is only shown while developing — those messages
 * are internal diagnostics, so in production they stay in captureError's hands.
 *
 * Returns a cleanup function that removes the card again.
 */
export function showSetupErrorOverlay(error: unknown): () => void {
  if (!canMountIntoDom()) {
    return () => {};
  }
  if (!HexclaveSetupError.isSetupError(error) && !isLikelyDevelopmentEnvironment()) {
    return () => {};
  }

  const issue = toSetupIssue(error);
  const existingInstance = getGlobalUiInstance(GLOBAL_INSTANCE_KEY);
  if (existingInstance != null) {
    // A single broken setup usually throws the same error on every page load and sometimes from several flows at once.
    // Stacking cards on top of each other would only hide the first (and most relevant) one, so later errors keep to
    // captureError and leave the card that is already up alone.
    return () => {};
  }

  const root = h("div", { className: "hexclave-setup-error-overlay" });
  const style = h("style", null, css);
  root.appendChild(style);
  document.body.appendChild(root);

  const render = (minimized: boolean) => {
    root.replaceChildren(style);
    if (minimized) {
      root.appendChild(renderIssuePill({
        kind: "error",
        label: "Setup error",
        ariaLabel: "Show Hexclave setup error",
        onClick: () => render(false),
      }));
      return;
    }
    root.appendChild(renderIssueCard({
      kind: "error",
      badge: "Setup error",
      title: issue.title,
      bodyText: "Hexclave stopped the authentication flow that ran into this error, so nobody can sign in through it until it is fixed.",
      messageLabel: "Error message",
      message: issue.message,
      howToFix: issue.howToFix,
      footerText: "This card is shown by the Hexclave SDK. Fix the problem above and reload the page to try the flow again.",
      ariaLabel: "Hexclave setup error",
      aiPrompt: buildAiPrompt(issue),
      onCopyError: (copyError) => captureError("setup-error-overlay-copy", copyError),
      onCopyAiPromptError: (copyError) => captureError("setup-error-overlay-copy-ai-prompt", copyError),
      onMinimize: () => render(true),
    }));
  };
  render(false);

  const cleanup = () => {
    root.remove();
    if (getGlobalUiInstance(GLOBAL_INSTANCE_KEY)?.cleanup === cleanup) {
      setGlobalUiInstance(GLOBAL_INSTANCE_KEY, null);
    }
  };
  setGlobalUiInstance(GLOBAL_INSTANCE_KEY, { cleanup });
  return cleanup;
}

// END_PLATFORM
