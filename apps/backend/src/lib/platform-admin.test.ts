import { describe, expect, it, vi } from "vitest";
import { ensurePlatformAdmin, isPlatformAdmin } from "./platform-admin";
import * as projects from "./projects";

vi.mock("./projects", () => ({
  listManagedProjectIds: vi.fn(),
}));

const mockListManagedProjectIds = vi.mocked(projects.listManagedProjectIds);

// Minimal stub satisfying the UsersCrud["Admin"]["Read"] shape required by the functions.
// The actual user object is only forwarded to listManagedProjectIds, which is mocked.
const fakeUser = { id: "user-1" } as Parameters<typeof isPlatformAdmin>[0];

describe("isPlatformAdmin", () => {
  it("returns true when user manages the internal project", async () => {
    mockListManagedProjectIds.mockResolvedValue(["internal", "other-project"]);
    await expect(isPlatformAdmin(fakeUser)).resolves.toBe(true);
    expect(mockListManagedProjectIds).toHaveBeenCalledWith(fakeUser);
  });

  it("returns false when user does not manage the internal project", async () => {
    mockListManagedProjectIds.mockResolvedValue(["some-project", "another-project"]);
    await expect(isPlatformAdmin(fakeUser)).resolves.toBe(false);
  });

  it("returns false when user manages no projects", async () => {
    mockListManagedProjectIds.mockResolvedValue([]);
    await expect(isPlatformAdmin(fakeUser)).resolves.toBe(false);
  });
});

describe("ensurePlatformAdmin", () => {
  it("resolves without throwing for platform admins", async () => {
    mockListManagedProjectIds.mockResolvedValue(["internal"]);
    await expect(ensurePlatformAdmin(fakeUser)).resolves.toBeUndefined();
  });

  it("throws a 403 StatusError for non-platform-admins", async () => {
    mockListManagedProjectIds.mockResolvedValue(["customer-project"]);
    await expect(ensurePlatformAdmin(fakeUser)).rejects.toMatchObject({
      statusCode: 403,
      message: "You do not have access to platform analytics.",
    });
  });

  it("throws a 403 StatusError when user manages no projects at all", async () => {
    mockListManagedProjectIds.mockResolvedValue([]);
    await expect(ensurePlatformAdmin(fakeUser)).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});
