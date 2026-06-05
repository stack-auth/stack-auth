// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarLayout } from "./sidebar-layout";

vi.mock("@hexclave/shared/dist/hooks/use-hash", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    useHash: () => {
      const [hash, setHash] = React.useState(() => window.location.hash.substring(1));
      React.useEffect(() => {
        const interval = setInterval(() => setHash(window.location.hash.substring(1)), 10);
        return () => clearInterval(interval);
      }, []);
      return hash;
    },
  };
});

vi.mock("@hexclave/ui", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    Button: ({ children, onClick }: { children: React.ReactNode, onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void }) => (
      React.createElement("button", { type: "button", onClick }, children)
    ),
    Typography: ({ children }: { children: React.ReactNode }) => React.createElement("div", null, children),
    cn: (...classes: unknown[]) => classes.filter(Boolean).join(" "),
  };
});

const previousActEnvironment = Reflect.get(globalThis, "IS_REACT_ACT_ENVIRONMENT");

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function renderSidebar() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <SidebarLayout
        items={[
          {
            title: "My Profile",
            type: "item",
            id: "profile",
            content: <div>Profile content</div>,
          },
          {
            title: "API Keys",
            type: "item",
            id: "api-keys",
            content: <div>API keys content</div>,
          },
        ]}
      />
    );
  });
}

function getButton(label: string): HTMLButtonElement {
  const button = [...container?.querySelectorAll("button") ?? []]
    .find((element) => element.textContent === label);
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Could not find button ${label}`);
  }
  return button;
}

describe("SidebarLayout", () => {
  beforeEach(() => {
    Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
    window.history.replaceState({}, "", "/handler/account-settings");
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    root = null;
    container = null;
    window.history.replaceState({}, "", "/");
    Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", previousActEnvironment);
  });

  it("switches tabs by updating the local URL hash", async () => {
    await renderSidebar();

    expect(container?.textContent).toContain("Profile content");

    await act(async () => {
      getButton("API Keys").click();
      await new Promise(resolve => setTimeout(resolve, 20));
    });

    expect(window.location.hash).toBe("#api-keys");
    expect(container?.textContent).toContain("API keys content");
  });
});
