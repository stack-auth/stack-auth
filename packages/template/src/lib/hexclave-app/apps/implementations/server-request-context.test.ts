import { describe, expect, it } from "vitest";
import { withExplicitServerUser, type ServerRequestSpanContext } from "./server-request-context";

const REQUEST_USER = "11111111-1111-4111-8111-111111111111";
const OTHER_USER = "22222222-2222-4222-8222-222222222222";

const requestContext: ServerRequestSpanContext = {
  userId: REQUEST_USER,
  refreshTokenId: "33333333-3333-4333-8333-333333333333",
  sessionReplayId: "44444444-4444-4444-8444-444444444444",
  sessionReplaySegmentId: "segment-a",
  customParentSpanIds: ["55555555-5555-4555-8555-555555555555"],
};

describe("withExplicitServerUser", () => {
  it("keeps request ancestry when attribution is implicit or matches the authenticated user", () => {
    expect(withExplicitServerUser(requestContext, null)).toEqual(requestContext);
    expect(withExplicitServerUser(requestContext, REQUEST_USER)).toEqual(requestContext);
  });

  it("detaches all request ancestry when an explicit user differs", () => {
    expect(withExplicitServerUser(requestContext, OTHER_USER)).toEqual({
      userId: OTHER_USER,
      refreshTokenId: null,
      sessionReplayId: null,
      sessionReplaySegmentId: null,
      customParentSpanIds: [],
    });
  });

  it("does not attach an explicitly attributed user to anonymous request ancestry", () => {
    expect(withExplicitServerUser({ ...requestContext, userId: null }, OTHER_USER)).toEqual({
      userId: OTHER_USER,
      refreshTokenId: null,
      sessionReplayId: null,
      sessionReplaySegmentId: null,
      customParentSpanIds: [],
    });
  });
});
