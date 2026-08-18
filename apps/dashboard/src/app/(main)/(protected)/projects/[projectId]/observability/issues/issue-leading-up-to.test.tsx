// @vitest-environment jsdom

import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IssueLeadingUpTo } from "./issue-leading-up-to";

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

describe("IssueLeadingUpTo", () => {
  it("opens the full log event when a correlation row is clicked", () => {
    render(
      <IssueLeadingUpTo
        lines={[{
          eventAtMillis: 1_700_000_000_000,
          level: "warn",
          message: JSON.stringify({
            type: "string",
            value: "Fetched user.useTeams() on /projects/internal\n\nDetails:\n  cache: AsyncCache",
          }),
          serviceName: "dashboard",
        }]}
        error={null}
        subtitle="same trace"
        hasCorrelation
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "View log event 1" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeDefined();
    expect(within(dialog).getByRole("heading", { name: "Log event" })).toBeDefined();
    expect(within(dialog).getByText("string")).toBeDefined();
    expect(within(dialog).getByText(/Fetched user\.useTeams\(\) on \/projects\/internal/)).toBeDefined();
    expect(within(dialog).getByText(/AsyncCache/)).toBeDefined();
    expect(within(dialog).getByText("dashboard")).toBeDefined();
  });
});
