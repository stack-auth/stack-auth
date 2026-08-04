import { hexclaveAppInternalsSymbol } from "@/lib/hexclave-app-internals";
import { describe, expect, it, vi } from "vitest";
import { completeGtmOnboardingIntake, getGtmOnboardingCompletionStatus, listGtmOnboardedProjects, loadGtmDataset } from "./gtm-api";

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

describe("loadGtmDataset", () => {
  function emptyPageApp() {
    const sendRequest = vi.fn(async (_path: string, _requestOptions: RequestInit, _requestType?: "client" | "server" | "admin") => {
      return new Response(JSON.stringify({ items: [], next_cursor: null }), { status: 200 });
    });
    return { sendRequest, app: { [hexclaveAppInternalsSymbol]: { sendRequest } } };
  }

  it("reads a project's own workspace with admin access and no project_id", async () => {
    // The owned-project admin app never sends an access token, so an admin request is the only
    // authorization it can present — and the project it names is the one the key belongs to.
    const { sendRequest, app } = emptyPageApp();

    await loadGtmDataset(app, { kind: "own-project" });

    expect(sendRequest.mock.calls.map((call) => [call[0], call[2]])).toEqual([
      ["/internal/gtm/insights", "admin"],
      ["/internal/gtm/actions", "admin"],
      ["/internal/gtm/notes", "admin"],
    ]);
  });

  it("reads a managed project by naming it, through the dashboard's own session", async () => {
    const { sendRequest, app } = emptyPageApp();

    await loadGtmDataset(app, { kind: "managed-project", projectId: "project-1" });

    expect(sendRequest.mock.calls.map((call) => [call[0], call[2]])).toEqual([
      ["/internal/gtm/insights?project_id=project-1", "client"],
      ["/internal/gtm/actions?project_id=project-1", "client"],
      ["/internal/gtm/notes?project_id=project-1", "client"],
    ]);
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

describe("curated timelines", () => {
  const insightPayload = (timelineEntries: unknown) => ({
    id: "00000000-0000-4000-8000-000000000101",
    created_at_millis: 1,
    updated_at_millis: 2,
    domain: "product",
    title: "A signal",
    body: "Body",
    impact_score: 10,
    times_seen: 1,
    last_seen_at_millis: 3,
    timeline_entries: timelineEntries,
  });

  // loadGtmDataset fetches insights, actions and notes in parallel, so the mock has to answer per path;
  // only the insights page carries the payload under test.
  const appWith = (insightsResponse: unknown) => ({
    [hexclaveAppInternalsSymbol]: {
      sendRequest: vi.fn(async (path: string) => new Response(
        JSON.stringify(path.startsWith("/internal/gtm/insights") ? insightsResponse : { items: [], next_cursor: null }),
        { status: 200 },
      )),
    },
  });

  it("maps a stored timeline into camelCase entries", async () => {
    const app = appWith({
      items: [insightPayload([{ label: "Kickoff", title: "We met", body: "Notes", date_millis: 1_700_000_000_000 }])],
      next_cursor: null,
    });

    const dataset = await loadGtmDataset(app, { kind: "own-project" });
    expect(dataset.insights[0].timeline).toEqual([
      { label: "Kickoff", title: "We met", body: "Notes", dateMillis: 1_700_000_000_000 },
    ]);
  });

  it("keeps null and empty timelines distinct, since they mean different things", async () => {
    const uncurated = await loadGtmDataset(appWith({ items: [insightPayload(null)], next_cursor: null }), { kind: "own-project" });
    expect(uncurated.insights[0].timeline).toBe(null);

    const curatedEmpty = await loadGtmDataset(appWith({ items: [insightPayload([])], next_cursor: null }), { kind: "own-project" });
    expect(curatedEmpty.insights[0].timeline).toEqual([]);
  });
});
