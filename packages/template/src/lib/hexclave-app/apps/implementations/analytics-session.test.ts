// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { createAnonymousAnalyticsTokenStore, makeAnonymousAnalyticsTokenStorageKey, parseAnonymousAnalyticsTokens } from "./analytics-session";

const PROJECT_ID = "00000000-0000-4000-8000-000000000000";

afterEach(() => {
  localStorage.clear();
});

describe("anonymous analytics session", () => {
  it("persists its private identity across SSR page reloads", () => {
    const firstPageStore = createAnonymousAnalyticsTokenStore(PROJECT_ID);
    firstPageStore.set({ accessToken: "access-token", refreshToken: "refresh-token" });

    const nextPageStore = createAnonymousAnalyticsTokenStore(PROJECT_ID);

    expect(nextPageStore.get()).toEqual({
      accessToken: "access-token",
      refreshToken: "refresh-token",
    });
  });

  it("fails closed on malformed persisted identities", () => {
    expect(parseAnonymousAnalyticsTokens('{"accessToken":7,"refreshToken":"refresh-token"}')).toEqual({
      accessToken: null,
      refreshToken: null,
    });
  });

  it("removes the persisted identity when its session is invalidated", () => {
    const store = createAnonymousAnalyticsTokenStore(PROJECT_ID);
    store.set({ accessToken: "access-token", refreshToken: "refresh-token" });
    store.set({ accessToken: null, refreshToken: null });

    expect(localStorage.getItem(makeAnonymousAnalyticsTokenStorageKey(PROJECT_ID))).toBeNull();
  });
});
