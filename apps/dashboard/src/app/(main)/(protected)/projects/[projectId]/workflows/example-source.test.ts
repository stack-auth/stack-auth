import { describe, expect, test } from "vitest";
import { getNewWorkflowSource } from "./example-source";

describe("getNewWorkflowSource", () => {
  test("returns the minimal starter with the entered workflow ID", () => {
    expect(getNewWorkflowSource("test")).toMatchInlineSnapshot(`
      "import { workflow, hexclaveApp } from \"@hexclave/workflows\";

      export default workflow(\"test\", {
        on: [],
      }, async (event, step) => {

      });
      "
    `);
  });
});
