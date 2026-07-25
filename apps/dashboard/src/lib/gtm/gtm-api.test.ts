import { hexclaveAppInternalsSymbol } from "@/lib/hexclave-app-internals";
import { describe, expect, it, vi } from "vitest";
import { completeGtmOnboardingIntake, getGtmOnboardingCompletionStatus, listGtmOnboardedProjects } from "./gtm-api";

describe("getGtmOnboardingCompletionStatus", () => {
  it("loads the minimal onboarding status with dashboard admin access", async () => {
    const sendRequest = vi.fn(async () => new Response(JSON.stringify({
      completed: false,
      completed_at_millis: null,
    }), { status: 200 }));
    const app = {
      [hexclaveAppInternalsSymbol]: {
        sendRequest,
      },
    };

    await expect(getGtmOnboardingCompletionStatus(app)).resolves.toEqual({
      completed: false,
      completed_at_millis: null,
    });
    expect(sendRequest).toHaveBeenCalledWith(
      "/internal/gtm/onboarding",
      {
        headers: {
          "content-type": "application/json",
        },
      },
      "admin",
    );
  });
});

describe("completeGtmOnboardingIntake", () => {
  it("accepts a completed response without requiring editable details", async () => {
    const sendRequest = vi.fn(async () => new Response(JSON.stringify({
      completed: true,
      completed_at_millis: 1_753_382_400_000,
      // Editable detail fields are intentionally not part of the initial
      // intake completion contract.
      details: null,
    }), { status: 200 }));
    const app = {
      [hexclaveAppInternalsSymbol]: {
        sendRequest,
      },
    };

    await expect(completeGtmOnboardingIntake(app, {
      domain: "",
      phone: "+1 415 555 0100",
      notes: "",
    })).resolves.toEqual({
      completed: true,
      completed_at_millis: 1_753_382_400_000,
    });
    expect(sendRequest).toHaveBeenCalledWith(
      "/internal/gtm/onboarding/details",
      {
        method: "POST",
        body: JSON.stringify({ domain: "", phone: "+1 415 555 0100", notes: "" }),
        headers: {
          "content-type": "application/json",
        },
      },
      "admin",
    );
  });
});

describe("listGtmOnboardedProjects", () => {
  it("maps each project's submitted onboarding details", async () => {
    const sendRequest = vi.fn(async () => new Response(JSON.stringify({
      items: [{
        id: "project-1",
        display_name: "Acme GTM",
        completed_at_millis: 1_753_382_400_000,
        details: {
          domain: "acme.example.com",
          phone: "+1 415 555 0100",
          notes: "Ready for GTM.",
        },
      }],
    }), { status: 200 }));
    const app = {
      [hexclaveAppInternalsSymbol]: {
        sendRequest,
      },
    };

    await expect(listGtmOnboardedProjects(app)).resolves.toEqual([{
      id: "project-1",
      displayName: "Acme GTM",
      completedAtMillis: 1_753_382_400_000,
      details: {
        domain: "acme.example.com",
        phone: "+1 415 555 0100",
        notes: "Ready for GTM.",
      },
    }]);
  });
});
