import { isValidConfig, normalize } from "./config/format";

const stackConfigImportStatement = 'import { defineStackConfig } from "@stackframe/stack-shared/config";';

export function renderConfigFileContent(config: unknown): string {
  if (!isValidConfig(config)) {
    throw new Error("Config file content is invalid. The file must export a 'config' object.");
  }

  const normalizedConfig = normalize(config, {
    onDotIntoNonObject: "ignore",
    onDotIntoNull: "empty-object",
  });
  return `${stackConfigImportStatement}\n\nexport const config = defineStackConfig(${JSON.stringify(normalizedConfig, null, 2)});\n`;
}

import.meta.vitest?.test("renderConfigFileContent normalizes config exports", ({ expect }) => {
  expect(renderConfigFileContent({
    "payments.items.todos.displayName": "Todo Slots",
    "payments.items.todos.customerType": "user",
  })).toContain(`export const config = defineStackConfig({
  "payments": {
    "items": {
      "todos": {
        "displayName": "Todo Slots",
        "customerType": "user"
      }
    }
  }
});`);
});

import.meta.vitest?.test("renderConfigFileContent rejects invalid config exports", ({ expect }) => {
  expect(() => renderConfigFileContent(null)).toThrowErrorMatchingInlineSnapshot(
    `[Error: Config file content is invalid. The file must export a 'config' object.]`,
  );
});
