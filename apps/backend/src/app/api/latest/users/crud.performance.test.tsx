import { performance } from "perf_hooks";

import { describe, expect, it } from "vitest";

import { mapUserLastActiveAtMillis } from "./last-active";

const quadraticResolver = (
  events: Array<{ userId: string, lastActiveAt: Date }>,
  userIds: string[],
  userSignedUpAtMillis: (number | Date)[],
) => {
  return userIds.map((userId, index) => {
    const event = events.find((candidate) => candidate.userId === userId);
    if (event) {
      return event.lastActiveAt.getTime();
    }

    const signedUpAt = userSignedUpAtMillis[index];
    return typeof signedUpAt === "number" ? signedUpAt : signedUpAt.getTime();
  });
};

describe("mapUserLastActiveAtMillis", () => {
  it("resolves large user lists significantly faster than the quadratic approach", () => {
    const userCount = 10_000;
    const userIds = Array.from({ length: userCount }, (_, index) => `user-${index}`);
    const userSignedUpAtMillis = userIds.map((_, index) => new Date(2020, 0, 1 + index));
    const events = userIds
      .map((userId, index) => ({
        userId,
        lastActiveAt: new Date(2020, 5, (index % 28) + 1, index % 24),
      }))
      .reverse();

    const warmUp = mapUserLastActiveAtMillis(events, userIds, userSignedUpAtMillis);
    expect(warmUp).toHaveLength(userCount);

    const linearStart = performance.now();
    const linearResult = mapUserLastActiveAtMillis(events, userIds, userSignedUpAtMillis);
    const linearDuration = performance.now() - linearStart;

    const quadraticStart = performance.now();
    const quadraticResult = quadraticResolver(events, userIds, userSignedUpAtMillis);
    const quadraticDuration = performance.now() - quadraticStart;

    expect(linearResult).toStrictEqual(quadraticResult);
    console.log("linearDuration", linearDuration);
    console.log("quadraticDuration", quadraticDuration);
  });
});
