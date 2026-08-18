// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PageLayout } from "./page-layout";

afterEach(() => {
  cleanup();
});

describe("PageLayout shell attributes", () => {
  it("renders shell attributes on an outermost layout", () => {
    const { container } = render(
      <PageLayout containedHeight fullBleed>
        <div />
      </PageLayout>,
    );

    const containedHeightLayouts = container.querySelectorAll("[data-contained-height]");
    const fullBleedLayouts = container.querySelectorAll("[data-full-bleed]");
    expect(containedHeightLayouts).toHaveLength(1);
    expect(fullBleedLayouts).toHaveLength(1);
    expect(containedHeightLayouts[0].getAttribute("data-contained-height")).toBe("true");
    expect(fullBleedLayouts[0].getAttribute("data-full-bleed")).toBe("true");
  });

  it("does not expose shell attributes from nested layouts", () => {
    const { container } = render(
      <PageLayout containedHeight fullBleed>
        <PageLayout containedHeight fullBleed>
          <div />
        </PageLayout>
      </PageLayout>,
    );

    expect(container.querySelectorAll("[data-contained-height]")).toHaveLength(1);
    expect(container.querySelectorAll("[data-full-bleed]")).toHaveLength(1);
  });
});
