import backendPackageJson from "../../package.json";
import { initializeNodeEnvironment } from "./node-environment";
import { test } from "vitest";

test("the production launcher preserves an explicit test environment", ({ expect }) => {
  const environment = { NODE_ENV: "test" };
  expect(initializeNodeEnvironment(environment)).toBe("test");
});

test("the production launcher trims an explicit environment", ({ expect }) => {
  const environment = { NODE_ENV: " production\n" };
  expect(initializeNodeEnvironment(environment)).toBe("production");
  expect(environment.NODE_ENV).toBe("production");
});

test("the production launcher defaults an unset environment to production", ({ expect }) => {
  const environment = {};
  expect(initializeNodeEnvironment(environment)).toBe("production");
  expect(Reflect.get(environment, "NODE_ENV")).toBe("production");
});

test("the production launcher defaults an empty environment to production", ({ expect }) => {
  const environment = { NODE_ENV: "  " };
  expect(initializeNodeEnvironment(environment)).toBe("production");
  expect(environment.NODE_ENV).toBe("production");
});

test("the package start command leaves NODE_ENV ownership to the launcher", ({ expect }) => {
  expect(backendPackageJson.scripts.start).not.toMatch(/\bNODE_ENV\s*=/);
});
