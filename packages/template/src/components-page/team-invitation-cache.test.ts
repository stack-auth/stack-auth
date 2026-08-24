import { describe, expect, it, vi } from "vitest";
import { cacheTeamInvitationOperation } from "./team-invitation-cache";

describe("cacheTeamInvitationOperation", () => {
  it("reuses results within a session but not across sessions", async () => {
    let resultNumber = 0;
    const operation = vi.fn(async (_app: object, _code: string) => {
      resultNumber += 1;
      return resultNumber;
    });
    const cachedOperation = cacheTeamInvitationOperation(operation);
    const app = {};
    const firstSession = {};
    const secondSession = {};

    await expect(cachedOperation(app, firstSession, "shared-code")).resolves.toBe(1);
    await expect(cachedOperation(app, firstSession, "shared-code")).resolves.toBe(1);
    await expect(cachedOperation(app, secondSession, "shared-code")).resolves.toBe(2);
    expect(operation).toHaveBeenCalledTimes(2);
  });
});
