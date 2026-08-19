// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import PageClient from "./page-client";

vi.mock("../../../page-layout", () => ({
  PageLayout: (props: { title: string, children: ReactNode }) => <main><h1>{props.title}</h1>{props.children}</main>,
}));
vi.mock("../../components/frame", () => ({
  GrowthAppFrame: (props: { children: ReactNode }) => <div>{props.children}</div>,
}));

afterEach(() => cleanup());

describe("Growth finding detail page", () => {
  it("renders an explicit staff-only state without requesting internal evidence", () => {
    render(<PageClient />);

    expect(screen.getByText("Growth evidence is staff-only")).toBeTruthy();
    expect(screen.getByText(/not in the customer workspace/i)).toBeTruthy();
  });
});
