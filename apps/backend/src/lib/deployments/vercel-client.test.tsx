/* eslint-disable no-restricted-syntax -- this test must manipulate process.env
   directly to exercise the env-var handling that getEnvVariable() wraps. */
import { StatusError } from "@hexclave/shared/dist/utils/errors";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getVercelDeploymentsClientOrThrow, getVercelDeploymentsConfigOrNull } from "./vercel-client";

// The env-var handling can't be covered by e2e tests (the dev backend always
// has the mock credentials set), so the unconfigured-instance path is unit
// tested here instead.
describe("vercel deployments configuration", () => {
  const savedEnv: Record<string, string | undefined> = {};
  const ENV_KEYS = ["HEXCLAVE_VERCEL_BEARER_TOKEN", "HEXCLAVE_VERCEL_TEAM_ID", "HEXCLAVE_VERCEL_API_URL", "STACK_VERCEL_BEARER_TOKEN", "STACK_VERCEL_TEAM_ID", "STACK_VERCEL_API_URL"];

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  it("returns null when the instance has no Vercel credentials", () => {
    expect(getVercelDeploymentsConfigOrNull()).toBeNull();
  });

  it("returns null when only one of token/team is set", () => {
    process.env.HEXCLAVE_VERCEL_BEARER_TOKEN = "some-token";
    expect(getVercelDeploymentsConfigOrNull()).toBeNull();
    delete process.env.HEXCLAVE_VERCEL_BEARER_TOKEN;
    process.env.HEXCLAVE_VERCEL_TEAM_ID = "team_x";
    expect(getVercelDeploymentsConfigOrNull()).toBeNull();
  });

  it("throws a clean 400 (never a 5xx) when unconfigured", () => {
    let thrown: unknown;
    try {
      getVercelDeploymentsClientOrThrow();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(StatusError);
    expect((thrown as StatusError).statusCode).toBe(400);
    expect((thrown as StatusError).message).toMatchInlineSnapshot(`"Vercel deployments are not configured on this Hexclave instance. Set the HEXCLAVE_VERCEL_BEARER_TOKEN and HEXCLAVE_VERCEL_TEAM_ID environment variables on the server to enable them."`);
  });

  it("uses the real Vercel API by default and the mock endpoint for the mock token", () => {
    process.env.HEXCLAVE_VERCEL_BEARER_TOKEN = "some-real-token";
    process.env.HEXCLAVE_VERCEL_TEAM_ID = "team_x";
    expect(getVercelDeploymentsConfigOrNull()).toEqual({
      token: "some-real-token",
      teamId: "team_x",
      baseUrl: "https://api.vercel.com",
    });

    process.env.HEXCLAVE_VERCEL_BEARER_TOKEN = "mock_hexclave_vercel_key";
    const mockConfig = getVercelDeploymentsConfigOrNull();
    expect(mockConfig?.baseUrl).toMatch(/^http:\/\/localhost:\d+$/);

    process.env.HEXCLAVE_VERCEL_API_URL = "http://localhost:9999";
    expect(getVercelDeploymentsConfigOrNull()?.baseUrl).toBe("http://localhost:9999");
  });
});
