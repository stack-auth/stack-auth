import { describe, expect, it } from "vitest";
import { parseHexclaveConfigFileContent, tryParseHexclaveConfigFileContent } from "./hexclave-config-file";

describe("parseHexclaveConfigFileContent", () => {
  it("parses a plain object config", () => {
    const content = `
      export const config = {
        teams: {
          createPersonalTeamOnSignUp: true,
        },
      };
    `;
    expect(parseHexclaveConfigFileContent(content, "test.ts")).toEqual({
      teams: {
        createPersonalTeamOnSignUp: true,
      },
    });
  });

  it("parses config wrapped in defineHexclaveConfig", () => {
    const content = `
      import { defineHexclaveConfig } from "@hexclave/shared/config";

      export const config = defineHexclaveConfig({
        teams: {
          createPersonalTeamOnSignUp: true,
          allowClientTeamCreation: true,
        },
      });
    `;
    expect(parseHexclaveConfigFileContent(content, "test.ts")).toEqual({
      teams: {
        createPersonalTeamOnSignUp: true,
        allowClientTeamCreation: true,
      },
    });
  });

  it("parses config wrapped in defineStackConfig", () => {
    const content = `
      import { defineStackConfig } from "@hexclave/shared/config";

      export const config = defineStackConfig({
        auth: {
          allowSignUp: false,
        },
      });
    `;
    expect(parseHexclaveConfigFileContent(content, "test.ts")).toEqual({
      auth: {
        allowSignUp: false,
      },
    });
  });

  it("parses show-onboarding string literal", () => {
    const content = `export const config = "show-onboarding";`;
    expect(parseHexclaveConfigFileContent(content, "test.ts")).toBe("show-onboarding");
  });

  it("returns empty object for empty content", () => {
    expect(parseHexclaveConfigFileContent("", "test.ts")).toEqual({});
  });

  it("parses config with TypeScript type assertion", () => {
    const content = `
      export const config = {
        auth: {
          allowSignUp: true,
        },
      } as const;
    `;
    expect(parseHexclaveConfigFileContent(content, "test.ts")).toEqual({
      auth: {
        allowSignUp: true,
      },
    });
  });

  it("rejects unknown single-argument wrapper calls", () => {
    const content = `
      export const config = mergeWithDefaults({
        auth: { allowSignUp: false },
      });
    `;
    expect(() => parseHexclaveConfigFileContent(content, "test.ts")).toThrow();
    expect(tryParseHexclaveConfigFileContent(content, "test.ts")).toBeNull();
  });

  it("rejects multi-argument calls", () => {
    const content = `
      export const config = someHelper({ auth: {} }, { teams: {} });
    `;
    expect(() => parseHexclaveConfigFileContent(content, "test.ts")).toThrow();
    expect(tryParseHexclaveConfigFileContent(content, "test.ts")).toBeNull();
  });

  it("rejects wrapper call with non-static argument", () => {
    const content = `
      import { someValue } from "./other";
      export const config = defineHexclaveConfig(someValue);
    `;
    expect(() => parseHexclaveConfigFileContent(content, "test.ts")).toThrow();
    expect(tryParseHexclaveConfigFileContent(content, "test.ts")).toBeNull();
  });
});
