import { describe, expect, it } from "vitest";
import { isGrowthInterviewReleased } from "./interview-release";

/**
 * The predicate is one line, and pinning it looks trivial — but it is the ONLY thing standing
 * between a customer and a set of questions nobody has read, and it is applied by identity (a null
 * timestamp) rather than by a status string. A refactor that made it truthy-based would still pass
 * every other test in this repo while silently releasing plans held with a zero-epoch timestamp.
 *
 * The database side of the module (edit, delete, release, and the 404 the customer paths return for
 * a held plan) is covered end-to-end instead, since it is all Prisma writes with no logic to isolate.
 */
describe("isGrowthInterviewReleased", () => {
  it("holds a plan that has never been released", () => {
    expect(isGrowthInterviewReleased({ releasedAt: null })).toBe(false);
  });

  it("releases a plan with a timestamp", () => {
    expect(isGrowthInterviewReleased({ releasedAt: new Date("2026-08-15T09:00:00.000Z") })).toBe(true);
  });

  it("treats the unix epoch as released, not as absent", () => {
    // A truthiness check would call this held: `new Date(0)` is falsy in exactly the way an
    // accidental `if (interview.releasedAt)` refactor would be wrong about.
    expect(isGrowthInterviewReleased({ releasedAt: new Date(0) })).toBe(true);
  });
});
