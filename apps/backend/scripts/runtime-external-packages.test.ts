import { expect, it } from "vitest";
import tsdownConfig from "../tsdown.config";

it("externalizes Sentry while bundling ordinary backend dependencies", () => {
  if (!Array.isArray(tsdownConfig.external)) {
    throw new Error("Expected the backend tsdown external option to be an array");
  }
  if (typeof tsdownConfig.noExternal !== "function") {
    throw new Error("Expected the backend tsdown noExternal option to be a function");
  }

  expect({
    externalRoot: tsdownConfig.external.includes("@sentry/node"),
    noExternalRoot: tsdownConfig.noExternal("@sentry/node", undefined),
    noExternalSubpath: tsdownConfig.noExternal("@sentry/node/preload", undefined),
    bundlesElysia: tsdownConfig.noExternal("elysia", undefined),
  }).toMatchInlineSnapshot(`
    {
      "bundlesElysia": true,
      "externalRoot": true,
      "noExternalRoot": false,
      "noExternalSubpath": false,
    }
  `);
});
