// @vitest-environment jsdom

import { fireEvent, render } from "@testing-library/react";
import React, { useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { RouterProvider, useRouter } from "./router";

const nextRouter = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => nextRouter,
}));

function RouterIdentityProbe() {
  const router = useRouter();
  const firstRouter = useRef(router);
  const [, setRenderCount] = useState(0);

  return (
    <button type="button" onClick={() => setRenderCount((count) => count + 1)}>
      {firstRouter.current === router ? "stable" : "changed"}
    </button>
  );
}

describe("useRouter", () => {
  it("keeps its navigation wrapper stable across unrelated rerenders", () => {
    const view = render(
      <RouterProvider>
        <RouterIdentityProbe />
      </RouterProvider>,
    );
    const button = view.getByRole("button");

    expect(button.textContent).toBe("stable");
    fireEvent.click(button);
    expect(button.textContent).toBe("stable");
  });
});
