import { describe, expect, it } from "vitest";
import { parseStackFrames } from "./event-tracker";

describe("parseStackFrames", () => {
  it("parses Chrome/V8 stack traces", () => {
    const stack = `Error: something went wrong
    at Object.handler (app-abc123.js:42:15)
    at processRequest (app-abc123.js:100:3)
    at async Server.<anonymous> (server.js:55:9)`;

    const frames = parseStackFrames(stack);
    expect(frames).toEqual([
      { function_name: "Object.handler", filename: "app-abc123.js", lineno: 42, colno: 15 },
      { function_name: "processRequest", filename: "app-abc123.js", lineno: 100, colno: 3 },
      { function_name: "async Server.<anonymous>", filename: "server.js", lineno: 55, colno: 9 },
    ]);
  });

  it("parses Chrome frames without function name", () => {
    const stack = `Error: oops
    at https://example.com/assets/app-abc123.js:42:15
    at https://example.com/assets/vendor.js:100:3`;

    const frames = parseStackFrames(stack);
    expect(frames).toEqual([
      { function_name: null, filename: "https://example.com/assets/app-abc123.js", lineno: 42, colno: 15 },
      { function_name: null, filename: "https://example.com/assets/vendor.js", lineno: 100, colno: 3 },
    ]);
  });

  it("parses Firefox stack traces", () => {
    const stack = `handler@https://example.com/app.js:42:15
processRequest@https://example.com/app.js:100:3
@https://example.com/app.js:200:1`;

    const frames = parseStackFrames(stack);
    expect(frames).toEqual([
      { function_name: "handler", filename: "https://example.com/app.js", lineno: 42, colno: 15 },
      { function_name: "processRequest", filename: "https://example.com/app.js", lineno: 100, colno: 3 },
      { function_name: null, filename: "https://example.com/app.js", lineno: 200, colno: 1 },
    ]);
  });

  it("returns empty array for non-stack strings", () => {
    expect(parseStackFrames("just a plain error message")).toEqual([]);
    expect(parseStackFrames("")).toEqual([]);
  });

  it("caps at 50 frames", () => {
    const lines = Array.from({ length: 100 }, (_, i) =>
      `    at fn${i} (file.js:${i + 1}:1)`
    );
    const stack = `Error\n${lines.join("\n")}`;
    const frames = parseStackFrames(stack);
    expect(frames).toHaveLength(50);
    expect(frames[49].function_name).toBe("fn49");
  });
});
