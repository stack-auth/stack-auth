// @vitest-environment jsdom

import { DesignButton } from "@/components/design-components";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mutationLabels = ["Save as new profile", "Duplicate", "Save profile"] as const;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe.each(mutationLabels)("%s mutation button", (label) => {
  it("cannot submit the mutation twice while its returned promise is pending", async () => {
    const pending = Promise.withResolvers<void>();
    const mutate = vi.fn(() => pending.promise);
    render(<DesignButton onClick={mutate}>{label}</DesignButton>);

    const button = screen.getByRole("button", { name: label });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(mutate).toHaveBeenCalledOnce();
    expect(button.hasAttribute("disabled")).toBe(true);

    await act(async () => {
      pending.resolve();
      await pending.promise;
    });
    expect(button.hasAttribute("disabled")).toBe(false);
  });

  it("restores the button after an error without changing the existing alert handling", async () => {
    const alert = vi.spyOn(window, "alert").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const mutate = vi.fn(async () => {
      throw new Error(`${label} failed`);
    });
    render(<DesignButton onClick={mutate}>{label}</DesignButton>);

    const button = screen.getByRole("button", { name: label });
    fireEvent.click(button);

    await waitFor(() => expect(alert).toHaveBeenCalledOnce());
    expect(mutate).toHaveBeenCalledOnce();
    expect(button.hasAttribute("disabled")).toBe(false);
  });
});
