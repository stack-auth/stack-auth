import { Result } from "./results";

export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };

export type ReadonlyJson =
  | null
  | boolean
  | number
  | string
  | readonly ReadonlyJson[]
  | { readonly [key: string]: ReadonlyJson };

export function isJson(value: unknown): value is Json {
  switch (typeof value) {
    case "object": {
      if (value === null) return true;
      if (Array.isArray(value)) return value.every(isJson);
      return Object.keys(value).every(k => typeof k === "string") && Object.values(value).every(isJson);
    }
    case "string":
    case "number":
    case "boolean": {
      return true;
    }
    default: {
      return false;
    }
  }
}
import.meta.vitest?.test("isJson", ({ expect }) => {
  // Test primitive values
  expect(isJson(null)).toBe(true);
  expect(isJson(true)).toBe(true);
  expect(isJson(false)).toBe(true);
  expect(isJson(123)).toBe(true);
  expect(isJson("string")).toBe(true);

  // Test arrays
  expect(isJson([])).toBe(true);
  expect(isJson([1, 2, 3])).toBe(true);
  expect(isJson(["a", "b", "c"])).toBe(true);
  expect(isJson([1, "a", true, null])).toBe(true);
  expect(isJson([1, [2, 3], { a: "b" }])).toBe(true);

  // Test objects
  expect(isJson({})).toBe(true);
  expect(isJson({ a: 1, b: 2 })).toBe(true);
  expect(isJson({ a: "string", b: true, c: null })).toBe(true);
  expect(isJson({ a: [1, 2, 3], b: { c: "d" } })).toBe(true);

  // Test invalid JSON values
  expect(isJson(undefined)).toBe(false);
  expect(isJson(() => {})).toBe(false);
  expect(isJson(Symbol())).toBe(false);
  expect(isJson(BigInt(123))).toBe(false);

  // Test arrays with invalid JSON values
  expect(isJson([1, undefined, 3])).toBe(false);
  expect(isJson([1, () => {}, 3])).toBe(false);

  // Test objects with invalid JSON values
  expect(isJson({ a: 1, b: undefined })).toBe(false);
  expect(isJson({ a: 1, b: () => {} })).toBe(false);
});

export function parseJson(json: string): Result<Json> {
  return Result.fromThrowing(() => JSON.parse(json));
}
import.meta.vitest?.test("parseJson", ({ expect }) => {
  // Test valid JSON strings
  const nullResult = parseJson("null");
  expect(nullResult.status).toBe("ok");
  if (nullResult.status === "ok") {
    expect(nullResult.data).toBe(null);
  }

  const trueResult = parseJson("true");
  expect(trueResult.status).toBe("ok");
  if (trueResult.status === "ok") {
    expect(trueResult.data).toBe(true);
  }

  const numberResult = parseJson("123");
  expect(numberResult.status).toBe("ok");
  if (numberResult.status === "ok") {
    expect(numberResult.data).toBe(123);
  }

  const stringResult = parseJson('"string"');
  expect(stringResult.status).toBe("ok");
  if (stringResult.status === "ok") {
    expect(stringResult.data).toBe("string");
  }

  const emptyArrayResult = parseJson("[]");
  expect(emptyArrayResult.status).toBe("ok");
  if (emptyArrayResult.status === "ok") {
    expect(emptyArrayResult.data).toEqual([]);
  }

  const arrayResult = parseJson("[1,2,3]");
  expect(arrayResult.status).toBe("ok");
  if (arrayResult.status === "ok") {
    expect(arrayResult.data).toEqual([1, 2, 3]);
  }

  const emptyObjectResult = parseJson("{}");
  expect(emptyObjectResult.status).toBe("ok");
  if (emptyObjectResult.status === "ok") {
    expect(emptyObjectResult.data).toEqual({});
  }

  const objectResult = parseJson('{"a":1,"b":"string"}');
  expect(objectResult.status).toBe("ok");
  if (objectResult.status === "ok") {
    expect(objectResult.data).toEqual({ a: 1, b: "string" });
  }

  // Test invalid JSON strings
  expect(parseJson("").status).toBe("error");
  expect(parseJson("undefined").status).toBe("error");
  expect(parseJson("{").status).toBe("error");
  expect(parseJson('{"a":1,}').status).toBe("error");
  expect(parseJson("function(){}").status).toBe("error");
});

export function stringifyJson(json: Json): Result<string> {
  return Result.fromThrowing(() => JSON.stringify(json));
}
import.meta.vitest?.test("stringifyJson", ({ expect }) => {
  // Test primitive values
  const nullResult = stringifyJson(null);
  expect(nullResult.status).toBe("ok");
  if (nullResult.status === "ok") {
    expect(nullResult.data).toBe("null");
  }

  const trueResult = stringifyJson(true);
  expect(trueResult.status).toBe("ok");
  if (trueResult.status === "ok") {
    expect(trueResult.data).toBe("true");
  }

  const numberResult = stringifyJson(123);
  expect(numberResult.status).toBe("ok");
  if (numberResult.status === "ok") {
    expect(numberResult.data).toBe("123");
  }

  const stringResult = stringifyJson("string");
  expect(stringResult.status).toBe("ok");
  if (stringResult.status === "ok") {
    expect(stringResult.data).toBe('"string"');
  }

  // Test arrays
  const emptyArrayResult = stringifyJson([]);
  expect(emptyArrayResult.status).toBe("ok");
  if (emptyArrayResult.status === "ok") {
    expect(emptyArrayResult.data).toBe("[]");
  }

  const arrayResult = stringifyJson([1, 2, 3]);
  expect(arrayResult.status).toBe("ok");
  if (arrayResult.status === "ok") {
    expect(arrayResult.data).toBe("[1,2,3]");
  }

  // Test objects
  const emptyObjectResult = stringifyJson({});
  expect(emptyObjectResult.status).toBe("ok");
  if (emptyObjectResult.status === "ok") {
    expect(emptyObjectResult.data).toBe("{}");
  }

  const objectResult = stringifyJson({ a: 1, b: "string" });
  expect(objectResult.status).toBe("ok");
  if (objectResult.status === "ok") {
    expect(objectResult.data).toBe('{"a":1,"b":"string"}');
  }

  // Test nested structures
  const nested = { a: [1, 2, 3], b: { c: "d" } };
  const nestedResult = stringifyJson(nested);
  expect(nestedResult.status).toBe("ok");
  if (nestedResult.status === "ok") {
    expect(nestedResult.data).toBe('{"a":[1,2,3],"b":{"c":"d"}}');
  }

  // Test circular references (should error)
  const circular: any = { a: 1 };
  circular.self = circular;
  expect(stringifyJson(circular).status).toBe("error");
});
