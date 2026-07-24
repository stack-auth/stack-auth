import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthError } from "./errors.js";

const { getUser } = vi.hoisted(() => ({
  getUser: vi.fn(),
}));

vi.mock("@hexclave/js", () => ({
  StackClientApp: class {
    getUser = getUser;
  },
}));

import { getInternalUser } from "./app.js";

const auth = {
  apiUrl: "https://api.hexclave.com",
  dashboardUrl: "https://app.hexclave.com",
  publishableClientKey: "pck_test",
  refreshToken: "refresh-token",
};

describe("getInternalUser", () => {
  beforeEach(() => {
    getUser.mockReset();
  });

  it("throws a friendly auth error when there is no signed-in user", async () => {
    getUser.mockResolvedValue(null);

    const result = getInternalUser(auth);
    await expect(result).rejects.toBeInstanceOf(AuthError);
    await expect(result).rejects.toMatchObject({
      name: "AuthError",
      message: "Your session is invalid or expired. Run `hexclave login` again.",
    });
    await expect(result).rejects.not.toThrow("User is not signed in but getUser was called with");
    expect(getUser).toHaveBeenCalledWith({ includeRestricted: true });
  });

  it("throws a friendly onboarding error for restricted users", async () => {
    getUser.mockResolvedValue({ isRestricted: true });

    const result = getInternalUser(auth);
    await expect(result).rejects.toBeInstanceOf(AuthError);
    await expect(result).rejects.toThrow(
      "Finish setting up your account at https://app.hexclave.com/onboarding before using the CLI.",
    );
  });
});
