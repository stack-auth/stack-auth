import { recordClientRequest } from "../diagnostics";
import { test } from "../helpers";

test("records diagnostics from worker fixture one", () => {
  recordClientRequest({
    durationMs: 11,
    method: "GET",
    path: "/diagnostics-regression/one",
    status: 200,
  });
});
