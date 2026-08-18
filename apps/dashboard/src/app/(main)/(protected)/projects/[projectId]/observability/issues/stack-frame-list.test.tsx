// @vitest-environment jsdom

import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StackFrameList } from "./stack-frame-list";
import type { StackFrameView } from "./stack-frames";

vi.mock("@/components/design-components", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/design-components")>();
  return {
    ...actual,
    DesignDialog: ({ open, onOpenChange, title, description, children }: {
      open?: boolean,
      onOpenChange?: (open: boolean) => void,
      title?: ReactNode,
      description?: ReactNode,
      children?: ReactNode,
    }) => open ? (
      <div role="dialog">
        <h2>{title}</h2>
        <p>{description}</p>
        {children}
        <button type="button" onClick={() => onOpenChange?.(false)}>Close dialog</button>
      </div>
    ) : null,
  };
});

afterEach(() => cleanup());

const frame: StackFrameView = {
  filename: "client.js",
  function: "fetchData",
  module: "app/client.ts",
  abs_path: "/workspace/app/client.ts",
  lineno: 42,
  colno: 7,
  in_app: true,
  context: null,
  symbolication: { status: "symbolicated" },
};

describe("StackFrameList", () => {
  it("opens the selected frame details when a frame row is clicked", () => {
    render(<StackFrameList frames={[frame]} rawStack={null} order="innermost-first" />);

    fireEvent.click(screen.getByRole("button", { name: "View stack frame fetchData" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeDefined();
    expect(within(dialog).getByRole("heading", { name: "fetchData" })).toBeDefined();
    expect(within(dialog).getByText("app/client.ts:42:7", { selector: "dd" })).toBeDefined();
    expect(within(dialog).getByText("Mapped")).toBeDefined();
  });
});
