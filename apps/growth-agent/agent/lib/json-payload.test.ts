import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { actionItemPayloadSchema, jsonObjectSchema } from "./json-payload.ts";

const agentRoot = fileURLToPath(new URL("..", import.meta.url));

function findToolFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return findToolFiles(full);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [full] : [];
  });
}

const toolFiles = findToolFiles(join(agentRoot, "tools"))
  .concat(
    readdirSync(join(agentRoot, "subagents"), { withFileTypes: true })
      .filter(e => e.isDirectory())
      .flatMap(e => findToolFiles(join(agentRoot, "subagents", e.name, "tools"))),
  )
  .map(f => relative(agentRoot, f))
  .sort();

describe("tool input schemas", () => {
  it("finds every tool file, so the checks below cannot silently cover nothing", () => {
    expect(toolFiles.length).toBeGreaterThanOrEqual(18);
  });

  // THE REGRESSION THIS GUARDS: `z.json()` compiles to a self-referencing `$def`, and Wafer rejects
  // the entire request with `400 ... contains recursive JSON Schema references` when any tool in the
  // list carries one. Because provider fallback then quietly served the request from a ~4x slower
  // provider, the only visible symptom was "the agent is slow" — nothing failed. Asserting on the
  // whole tool list rather than the fields we happened to fix keeps a future `z.json()` from
  // reintroducing it in a tool nobody thought to check. See agent/lib/json-payload.ts.
  it.each(toolFiles)("%s emits no recursive $ref", async (file) => {
    const tool = (await import(join(agentRoot, file))).default;
    const jsonSchema = z.toJSONSchema(tool.inputSchema, { io: "input" });
    expect(JSON.stringify(jsonSchema)).not.toContain("$ref");
  });
});

describe("jsonObjectSchema", () => {
  it("accepts the shallow key-number bags these fields actually carry", () => {
    expect(jsonObjectSchema.safeParse({
      new_signups: 412,
      wow_change: -0.12,
      top_sources: ["google", "direct"],
      by_segment: { paid: { signups: 30 } },
    }).success).toBe(true);
  });

  // Deliberate tightening, and the only one versus z.json(). For `payload` the readers already
  // required a record; for `data`/`metadata` they did not, so this genuinely rejects something that
  // used to round-trip. Pinned as a test so the decision is visible rather than incidental.
  it("rejects a bare primitive and a top-level array", () => {
    expect(jsonObjectSchema.safeParse("just a string").success).toBe(false);
    expect(jsonObjectSchema.safeParse([1, 2, 3]).success).toBe(false);
  });

  // The first fix for the Wafer 400 spelled out a finite nesting depth, which traded one silent
  // failure (the recursive $ref) for a new hard limit on data we had always accepted. Keeping the
  // value type opaque avoids both: no $ref to reject, and no ceiling to trip over later.
  it("still accepts arbitrarily deep bags, exactly as z.json() did", () => {
    expect(jsonObjectSchema.safeParse({ a: { b: { c: { d: { e: [1, { f: 2 }] } } } } }).success).toBe(true);
  });
});

describe("actionItemPayloadSchema", () => {
  it("accepts a title-only blog idea, matching what extractGrowthBlogIdea accepts", () => {
    // The backend treats every field but the title as optional so a run that couldn't ground the
    // others still proposes the post. A stricter tool schema here would silently drop those items.
    expect(actionItemPayloadSchema.safeParse({ blog_idea: { title: "Why teams churn at week two" } }).success).toBe(true);
  });

  it("accepts a coding prompt alongside a blog idea, since the prompt renders for any action type", () => {
    expect(actionItemPayloadSchema.safeParse({
      coding_agent_prompt: "Add a checklist to the empty state.",
      blog_idea: { title: "T", target_intent: "compare", aeo_angle: "a", outline_summary: "s" },
    }).success).toBe(true);
  });

  it("rejects a misspelled key rather than storing an item that renders nothing", () => {
    expect(actionItemPayloadSchema.safeParse({ codeing_agent_prompt: "oops" }).success).toBe(false);
  });

  it("rejects draft_markdown, which only the backend may write back", () => {
    expect(actionItemPayloadSchema.safeParse({ draft_markdown: "# Post" }).success).toBe(false);
  });

  it("keeps ad_campaign open, matching the backend's deliberate object-only check", () => {
    expect(actionItemPayloadSchema.safeParse({
      ad_campaign: { objective: "signups", daily_budget: 50, targeting: { geo: ["US"] } },
    }).success).toBe(true);
  });
});

describe("actionItemPayloadSchema blog_idea leniency", () => {
  it("accepts explicit nulls for ungrounded fields, as both readers do", () => {
    expect(actionItemPayloadSchema.safeParse({
      blog_idea: { title: "T", target_intent: null, aeo_angle: null, outline_summary: null },
    }).success).toBe(true);
  });

  it("still requires a non-empty title, since extractGrowthBlogIdea drops the idea without one", () => {
    expect(actionItemPayloadSchema.safeParse({ blog_idea: { title: "   " } }).success).toBe(false);
    expect(actionItemPayloadSchema.safeParse({ blog_idea: { target_intent: "x" } }).success).toBe(false);
  });
});
