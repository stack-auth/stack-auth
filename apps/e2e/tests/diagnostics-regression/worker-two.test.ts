import { recordClientRequest } from "../diagnostics";
import { test } from "../helpers";

test("records diagnostics from worker fixture two", () => {
  recordClientRequest({
    durationMs: 22,
    method: "GET",
    path: "/diagnostics-regression/two",
    status: 200,
  });
});
