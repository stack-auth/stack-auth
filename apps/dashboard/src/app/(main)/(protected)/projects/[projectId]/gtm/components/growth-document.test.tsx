import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { GrowthDocument } from "@/lib/growth/growth-document";
import type { GrowthActionItem } from "@/lib/growth/growth-types";
import { GrowthDocumentActionsProvider, GrowthDocumentRenderer } from "./growth-document";

// An <ActionButton> links to the action's detail page, so the renderer reads the project from the
// route; server-rendering it in a test means standing in for the router.
vi.mock("next/navigation", () => ({
  usePathname: () => "/projects/00000000-0000-4000-8000-000000000000/gtm",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/components/link", () => ({
  Link: ({ href, children }: { href: string, children?: ReactNode }) => <a href={href}>{children}</a>,
}));

// The activate/dismiss controls talk to the API through the dashboard app context; this suite is about
// which action a page's reference resolves to, so they stand in as a marker.
vi.mock("./action-controls", () => ({
  GrowthActionMutationControls: () => <div>action controls</div>,
}));

function actionButtonDocument(actionId: string): GrowthDocument {
  return {
    format: "growth-mdx-v1",
    sourceMdx: `<ActionButton action="${actionId}" />`,
    blocks: [{ type: "component", name: "ActionButton", dataId: null, confidence: null, actionId, children: [] }],
    data: [],
  };
}

const ACTION: GrowthActionItem = {
  id: "11111111-1111-4111-8111-111111111111",
  typeId: "custom",
  category: "conversion",
  tags: [],
  title: "Trim the signup form",
  description: "Three fields instead of seven.",
  status: "proposed",
  payload: null,
  watchedMetrics: [{ metricId: "new_signups", windowDays: 14 }],
  reportId: null,
  briefId: null,
  workflow: null,
  createdAtMillis: 1_700_000_000_000,
  activatedAtMillis: null,
  completedAtMillis: null,
};

describe("GrowthDocumentRenderer", () => {
  it("renders the safe tree as scan-friendly semantic content", () => {
    const document: GrowthDocument = {
      format: "growth-mdx-v1",
      sourceMdx: "## What changed\n\n<Experiment>Test the shorter onboarding flow.</Experiment>",
      blocks: [
        { type: "heading", level: 2, children: [{ type: "text", value: "What changed" }] },
        {
          type: "component",
          name: "Experiment",
          dataId: null,
          confidence: null,
          actionId: null,
          children: [{ type: "paragraph", children: [{ type: "text", value: "Test the shorter onboarding flow." }] }],
        },
      ],
      data: [],
    };

    const html = renderToStaticMarkup(<GrowthDocumentRenderer document={document} />);
    expect(html).toContain("<h2");
    expect(html).toContain("What changed");
    expect(html).toContain("<aside");
    expect(html).toContain("Experiment");
    expect(html).toContain("Test the shorter onboarding flow.");
  });

  it("resolves an <ActionButton> against the workspace's own actions", () => {
    const html = renderToStaticMarkup(
      <GrowthDocumentActionsProvider actions={[ACTION]} demo={false} projectId="project-1" onChanged={async () => {}}>
        <GrowthDocumentRenderer document={actionButtonDocument(ACTION.id)} />
      </GrowthDocumentActionsProvider>,
    );
    expect(html).toContain("Trim the signup form");
    // The page carries a reference, not the action: nothing type-specific about the action leaks into
    // the rendered page beyond what the customer already sees on the action itself.
    expect(html).not.toContain("Three fields instead of seven.");
  });

  it("degrades to a notice when the referenced action is gone", () => {
    const html = renderToStaticMarkup(
      <GrowthDocumentActionsProvider actions={[]} demo={false} projectId="project-1" onChanged={async () => {}}>
        <GrowthDocumentRenderer document={actionButtonDocument(ACTION.id)} />
      </GrowthDocumentActionsProvider>,
    );
    expect(html).toContain("no longer available");
    expect(html).not.toContain(ACTION.id);
  });
});
