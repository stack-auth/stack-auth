import { isValidConfig, normalize } from "./config/format";

const stackConfigTypeImport = 'import type { StackConfig } from "@stackframe/js";';

export function renderConfigFileContent(config: unknown): string {
  if (!isValidConfig(config)) {
    throw new Error("Config file content is invalid. The file must export a 'config' object.");
  }

  const droppedKeys: string[] = [];
  const normalizedConfig = normalize(config, {
    onDotIntoNonObject: "ignore",
    onDotIntoNull: "empty-object",
    droppedKeys,
  });
  if (droppedKeys.length > 0) {
    throw new Error(`Config has conflicting keys that would be dropped during normalization: ${droppedKeys.map(k => JSON.stringify(k)).join(", ")}`);
  }
  return `${stackConfigTypeImport}\n\nexport const config: StackConfig = ${JSON.stringify(normalizedConfig, null, 2)};\n`;
}

import.meta.vitest?.test("renderConfigFileContent normalizes config exports", ({ expect }) => {
  expect(renderConfigFileContent({
    "payments.items.todos.displayName": "Todo Slots",
    "payments.items.todos.customerType": "user",
  })).toContain(`export const config: StackConfig = {
  "payments": {
    "items": {
      "todos": {
        "displayName": "Todo Slots",
        "customerType": "user"
      }
    }
  }
};`);
});

import.meta.vitest?.test("renderConfigFileContent rejects conflicting dotted keys", ({ expect }) => {
  expect(() => renderConfigFileContent({
    "a.b": 1,
    "a.b.c": 2,
  })).toThrowError(/conflicting keys.*"a\.b\.c"/);
});

import.meta.vitest?.test("renderConfigFileContent rejects invalid config exports", ({ expect }) => {
  expect(() => renderConfigFileContent(null)).toThrowErrorMatchingInlineSnapshot(
    `[Error: Config file content is invalid. The file must export a 'config' object.]`,
  );
});
