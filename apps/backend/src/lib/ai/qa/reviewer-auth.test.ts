import { KnownErrors } from "@hexclave/shared";
import { describe, expect, it } from "vitest";
import { assertIsAiChatReviewer } from "./reviewer-auth";

describe("assertIsAiChatReviewer", () => {
  it("allows approved internal reviewers", () => {
    expect(() => assertIsAiChatReviewer({
      project: { id: "internal" },
      user: { client_read_only_metadata: { isAiChatReviewer: true } },
    })).not.toThrow();
  });

  it("rejects requests outside the internal project", () => {
    expect(() => assertIsAiChatReviewer({
      project: { id: "customer-project" },
      user: { client_read_only_metadata: { isAiChatReviewer: true } },
    })).toThrow(KnownErrors.ExpectedInternalProject);
  });

  it("rejects unauthenticated users", () => {
    expect(() => assertIsAiChatReviewer({
      project: { id: "internal" },
      user: null,
    })).toThrow("You must be signed in to perform MCP review operations.");
  });

  it("rejects users without reviewer metadata", () => {
    expect(() => assertIsAiChatReviewer({
      project: { id: "internal" },
      user: { client_read_only_metadata: {} },
    })).toThrow("You are not approved to perform MCP review operations.");
  });
});
