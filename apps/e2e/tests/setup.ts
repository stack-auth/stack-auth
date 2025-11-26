import { afterEach, expect } from "vitest";
import { afterTestFinishesCallbacks } from "./helpers";

expect.extend({
  toSatisfy(received: string, predicate: (value: string) => boolean) {
    return {
      pass: predicate(received),
      message: () => `${received} does not satisfy predicate`,
    };
  },
});

afterEach(async () => {
  for (const callback of afterTestFinishesCallbacks) {
    await callback();
  }
  afterTestFinishesCallbacks.length = 0;
});
