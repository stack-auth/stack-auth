import { it } from "../helpers";
import { createApp } from "./js-helpers";


it("runs analytics queries via the server app", async ({ expect }) => {
  const { serverApp } = await createApp();

  const result = await serverApp.queryAnalytics({
    query: "SELECT {number:Int32} AS value",
    params: { number: 1 },
    timeout_ms: 2000,
    include_all_branches: false,
  });

  expect(result.result).toMatchInlineSnapshot(`[{ "value": 1 }]`);
}, {
  timeout: 40_000,
});
