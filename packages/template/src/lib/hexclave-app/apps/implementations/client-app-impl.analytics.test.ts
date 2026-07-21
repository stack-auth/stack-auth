// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { StackClientApp } from "../interfaces/client-app";
import { EventTracker } from "./event-tracker";
import { SessionRecorder } from "./session-replay";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("browser analytics startup", () => {
  it("starts replay and event capture for an SSR app with tokenStore null", () => {
    const replayStart = vi.spyOn(SessionRecorder.prototype, "start").mockImplementation(() => {});
    const eventStart = vi.spyOn(EventTracker.prototype, "start").mockImplementation(() => {});

    new StackClientApp({
      projectId: "00000000-0000-4000-8000-000000000001",
      publishableClientKey: "pck_test",
      baseUrl: "https://api.example.test",
      tokenStore: null,
      noAutomaticPrefetch: true,
      devTool: false,
    });

    expect(replayStart).toHaveBeenCalledOnce();
    expect(eventStart).toHaveBeenCalledOnce();
  });
});
