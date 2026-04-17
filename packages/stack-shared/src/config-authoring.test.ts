import { expect, it } from "vitest";
import { typeAssertExtends } from "./utils/types";
import { defineStackConfig, type StackConfig } from "./config-authoring";

const validConfig = defineStackConfig({
  payments: {
    items: {
      todos: {
        displayName: "Todo Slots",
        customerType: "user",
      },
    },
  },
});

typeAssertExtends<typeof validConfig, StackConfig>()();

it("returns its input unchanged", () => {
  expect(defineStackConfig(validConfig)).toBe(validConfig);
});

defineStackConfig({
  // @ts-expect-error Top-level dot notation should not be accepted in typed config files.
  "payments.items": {
    todos: {
      displayName: "Todo Slots",
      customerType: "user",
    },
  },
});

defineStackConfig({
  payments: {
    // @ts-expect-error Unknown keys should not be accepted in typed config files.
    missingField: true,
  },
});

defineStackConfig({
  payments: {
    items: {
      todos: {
        displayName: "Todo Slots",
        // @ts-expect-error Invalid enum values should fail type-checking.
        customerType: "workspace",
      },
    },
  },
});
