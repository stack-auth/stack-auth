import { workflowPlatformEventTypes } from "@hexclave/shared/dist/interface/workflows";
import { throwErr } from "@hexclave/shared/dist/utils/errors";
import { describe, expect, it } from "vitest";
import { GROWTH_WORKFLOWS_EDITOR_AMBIENT_DTS, GROWTH_WORKFLOWS_EDITOR_DTS } from "./workflow-authoring-dts";

/**
 * The growth DTS is a hand-maintained copy (see the module header for why), so nothing about it is
 * verified by the type system. These tests pin the one drift mode that is mechanically checkable:
 * the platform event catalog. If someone adds an event to workflows.ts and forgets this file, the
 * agent would keep writing workflows that cannot subscribe to it — and that would surface as an
 * agent quality problem rather than as a stale constant.
 */

/**
 * Non-greedy up to the first `  };` at the type's own indentation, because the payload values
 * contain nested braces (`{ id: string, teams: { id: string }[] }`) that a brace-counting pattern
 * trips over.
 */
function getPlatformEventMapBody(): string {
  const match = GROWTH_WORKFLOWS_EDITOR_DTS.match(/export type WorkflowPlatformEventMap = \{([\s\S]*?)\n {2}\};/);
  return match?.[1] ?? throwErr("WorkflowPlatformEventMap is no longer declared in the growth DTS — the copy has drifted structurally, not just in content.");
}

describe("growth workflow authoring DTS", () => {
  it("declares every platform event the workflow engine can trigger on", () => {
    const body = getPlatformEventMapBody();
    for (const eventType of workflowPlatformEventTypes) {
      expect(body, `"${eventType}" is missing from the growth DTS copy`).toContain(`"${eventType}":`);
    }
  });

  it("declares no event the workflow engine does not know about", () => {
    const declared = [...getPlatformEventMapBody().matchAll(/"([a-z_.]+)":/g)].map((match) => match[1]);
    expect(declared.length).toBe(workflowPlatformEventTypes.length);
    for (const eventType of declared) {
      expect(workflowPlatformEventTypes, `"${eventType}" is declared in the growth DTS but is not a real platform event`).toContain(eventType);
    }
  });

  it("declares the module the workflow runtime actually provides", () => {
    // `@hexclave/workflows` is virtual (lib/workflows/runtime-source.tsx). If the declared module
    // name stops matching what workflow source imports, every generated workflow fails to resolve.
    expect(GROWTH_WORKFLOWS_EDITOR_DTS).toContain('declare module "@hexclave/workflows"');
    // date-fns is the only third-party import workflow source is allowed; the ambient stub is what
    // stops the agent's editor-equivalent view from treating it as unresolved.
    expect(GROWTH_WORKFLOWS_EDITOR_AMBIENT_DTS).toContain('declare module "date-fns"');
  });
});
