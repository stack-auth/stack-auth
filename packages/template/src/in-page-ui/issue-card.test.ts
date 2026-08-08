// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { renderIssueCard, trapFocusInIssueCard } from "./issue-card";

function mountCard(): HTMLElement {
  const root = document.body.appendChild(document.createElement("div"));
  root.appendChild(renderIssueCard({
    kind: "error",
    badge: "Config error",
    title: "Something is misconfigured",
    bodyText: "Body",
    messageLabel: "Error message",
    message: "Message",
    footerText: "Footer",
    ariaLabel: "Hexclave config error",
    aiPrompt: "prompt",
    onCopyError: () => {},
    onCopyAiPromptError: () => {},
    onMinimize: () => {},
  }));
  return root;
}

function pressTab() {
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
}

function cardButtons(root: HTMLElement): HTMLButtonElement[] {
  return [...root.querySelectorAll<HTMLButtonElement>(".hic-card button")];
}

describe("issue card focus trap", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("follows a re-rendered card without moving focus or losing the original focus owner", () => {
    const pageButton = document.body.appendChild(document.createElement("button"));
    pageButton.focus();

    const firstRoot = mountCard();
    const firstTrap = trapFocusInIssueCard(firstRoot);
    expect(document.activeElement).toBe(firstRoot.querySelector(".hic-card"));

    // What the pushed-config overlay does on every poll: throw the rendered card away and render a fresh one.
    firstRoot.remove();
    const secondRoot = mountCard();
    firstTrap.release({ restoreFocus: false });
    const secondTrap = trapFocusInIssueCard(secondRoot, {
      moveFocusIntoCard: false,
      previouslyFocused: firstTrap.previouslyFocused,
    });
    expect(document.activeElement).not.toBe(secondRoot.querySelector(".hic-card"));

    // The trap now belongs to the visible card, so Tab lands inside it instead of inside the detached one.
    pressTab();
    expect(document.activeElement).toBe(cardButtons(secondRoot)[0]);

    secondTrap.release();
    expect(document.activeElement).toBe(pageButton);
  });
});
