// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { getStripeConnectInstance } from "./stripe-connect-provider";

type ConnectOptions = {
  publishableKey: string,
  fetchClientSecret: () => Promise<string>,
};

const stripeMocks = vi.hoisted(() => ({
  loadConnectAndInitialize: vi.fn((options: ConnectOptions) => ({ options })),
}));

vi.mock("@stripe/connect-js", () => ({
  loadConnectAndInitialize: stripeMocks.loadConnectAndInitialize,
}));

vi.mock("@/lib/env", () => ({
  getPublicEnvVar: () => "pk_test_dashboard",
}));

vi.mock("@/lib/theme", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));

vi.mock("@/app/(main)/(protected)/projects/[projectId]/use-admin-app", () => ({
  useAdminApp: vi.fn(),
}));

function createAdminApp(clientSecret: string) {
  return {
    createStripeWidgetAccountSession: vi.fn(async () => ({ client_secret: clientSecret })),
  };
}

describe("getStripeConnectInstance", () => {
  beforeEach(() => {
    stripeMocks.loadConnectAndInitialize.mockClear();
  });

  it("reuses an instance only for the same session-bound admin app", async () => {
    const firstAdminApp = createAdminApp("secret-first");
    const secondAdminApp = createAdminApp("secret-second");

    const first = getStripeConnectInstance(firstAdminApp);
    const firstAgain = getStripeConnectInstance(firstAdminApp);
    const second = getStripeConnectInstance(secondAdminApp);

    expect(firstAgain).toBe(first);
    expect(second).not.toBe(first);
    expect(stripeMocks.loadConnectAndInitialize).toHaveBeenCalledTimes(2);

    const firstOptions = stripeMocks.loadConnectAndInitialize.mock.calls[0][0];
    const secondOptions = stripeMocks.loadConnectAndInitialize.mock.calls[1][0];
    await expect(firstOptions.fetchClientSecret()).resolves.toBe("secret-first");
    await expect(secondOptions.fetchClientSecret()).resolves.toBe("secret-second");
  });
});
