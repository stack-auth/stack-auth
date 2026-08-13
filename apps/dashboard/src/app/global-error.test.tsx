// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import GlobalError from "./global-error";
import {
  GLOBAL_ERROR_RECOVERY_ATTEMPTS_KEY,
  MAX_GLOBAL_ERROR_RECOVERY_ATTEMPTS,
} from "./global-error-recovery";

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

describe("global error screen", () => {
  it("shows a safe manual retry screen after automatic recovery stops", () => {
    window.sessionStorage.setItem(
      GLOBAL_ERROR_RECOVERY_ATTEMPTS_KEY,
      String(MAX_GLOBAL_ERROR_RECOVERY_ATTEMPTS),
    );

    render(<GlobalError error={new Error("internal failure details")} />);

    expect(screen.getByRole("heading", { name: "Something went wrong" })).toBeTruthy();
    expect(screen.getByText("The dashboard could not load this page. Try again, or reload the page manually later.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.queryByText("internal failure details")).toBeNull();
  });
});
