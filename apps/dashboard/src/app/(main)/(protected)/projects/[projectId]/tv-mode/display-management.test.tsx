// @vitest-environment jsdom

import { hexclaveAppInternalsSymbol } from "@/lib/hexclave-app-internals";
import { getTvBuiltInProfile, type TvDisplayResource } from "@hexclave/shared/dist/interface/admin-tv-mode";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getPairingFailureNotice, TvDisplayManagement } from "./display-management";

const display: TvDisplayResource = {
  id: "3af6ca2f-20eb-4c6b-a8b2-8f93d940f037",
  displayName: "Office Display",
  profileId: "company-pulse",
  profileDisplayName: "Company Pulse",
  profileFinancialVisibility: "redacted",
  state: "online",
  pairedAt: "2026-08-15T12:00:00.000Z",
  lastSeenAt: "2026-08-15T12:00:05.000Z",
  revokedAt: null,
  exactFinancialsAcknowledged: false,
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function getCompanyPulseProfile() {
  const profile = getTvBuiltInProfile("company-pulse");
  if (profile == null) throw new Error("Company Pulse profile is missing.");
  return profile;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("TV display pairing feedback", () => {
  it("recognizes a retried rate-limit failure without exposing its diagnostics", () => {
    const notice = getPairingFailureNotice(new AggregateError([
      new Error("Rate limited, no retry-after header received"),
    ]));

    expect(notice).toEqual({
      variant: "error",
      title: "Pairing Temporarily Paused",
      description: "Too many pairing attempts were received. Wait a few minutes, then use the latest code shown on the display.",
    });
  });

  it("submits once, shows progress, and reconciles the connected display without a reload", async () => {
    const approval = Promise.withResolvers<Response>();
    let approved = false;
    const requests: Array<{ path: string, method: string }> = [];
    const adminApp = {
      [hexclaveAppInternalsSymbol]: {
        sendRequest: async (path: string, options: RequestInit) => {
          const method = options.method ?? "GET";
          requests.push({ path, method });
          if (method === "POST") {
            const response = await approval.promise;
            approved = true;
            return response;
          }
          return jsonResponse({ displays: approved ? [display] : [] });
        },
      },
    };
    const alert = vi.spyOn(window, "alert").mockImplementation(() => undefined);
    render(<TvDisplayManagement adminApp={adminApp} profiles={[getCompanyPulseProfile()]} />);

    await waitFor(() => expect(screen.getByText("No displays are paired with this project yet.")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Pairing code"), { target: { value: "ABCD-EFGH" } });
    const pairButton = screen.getByRole("button", { name: "Pair Display" });
    fireEvent.click(pairButton);
    fireEvent.click(pairButton);

    expect(screen.getByText("Pairing Display")).toBeTruthy();
    expect(pairButton.hasAttribute("disabled")).toBe(true);
    expect(requests.filter((request) => request.method === "POST")).toHaveLength(1);

    await act(async () => {
      approval.resolve(jsonResponse({ success: true }));
      await approval.promise;
    });

    await waitFor(() => expect(screen.getByText("Display Paired")).toBeTruthy());
    expect(screen.getAllByText("Office Display").length).toBeGreaterThan(0);
    expect(alert).not.toHaveBeenCalled();
  });

  it("uses the design dialog to confirm unpairing and removes the active display immediately", async () => {
    const requests: Array<{ path: string, method: string }> = [];
    const adminApp = {
      [hexclaveAppInternalsSymbol]: {
        sendRequest: async (path: string, options: RequestInit) => {
          const method = options.method ?? "GET";
          requests.push({ path, method });
          if (method === "DELETE") return jsonResponse({ success: true });
          return jsonResponse({ displays: [display] });
        },
      },
    };
    render(<TvDisplayManagement adminApp={adminApp} profiles={[getCompanyPulseProfile()]} />);

    await waitFor(() => expect(screen.getByRole("button", { name: "Unpair" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Unpair" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText(/immediately lose access to TV Mode/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Unpair Display" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(requests.filter((request) => request.method === "DELETE")).toEqual([{
      path: `/internal/tv-mode/displays/${display.id}`,
      method: "DELETE",
    }]);
    expect(screen.getByText("No displays are paired with this project yet.")).toBeTruthy();
  });

  it("enables assignment saving only after the display configuration changes", async () => {
    const requests: Array<{ path: string, method: string, body: string | null }> = [];
    const adminApp = {
      [hexclaveAppInternalsSymbol]: {
        sendRequest: async (path: string, options: RequestInit) => {
          const method = options.method ?? "GET";
          requests.push({ path, method, body: typeof options.body === "string" ? options.body : null });
          if (method === "PATCH") return jsonResponse({ success: true });
          return jsonResponse({ displays: [display] });
        },
      },
    };
    render(<TvDisplayManagement adminApp={adminApp} profiles={[getCompanyPulseProfile()]} />);

    const savedButton = await screen.findByRole("button", { name: "Assignment Saved" });
    expect(savedButton.hasAttribute("disabled")).toBe(true);

    fireEvent.change(screen.getByLabelText("Display name for Office Display"), {
      target: { value: "Lobby Display" },
    });
    const saveButton = screen.getByRole("button", { name: "Save Assignment" });
    expect(saveButton.hasAttribute("disabled")).toBe(false);
    fireEvent.click(saveButton);

    await waitFor(() => expect(screen.getByText("Assignment Updated")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Assignment Saved" }).hasAttribute("disabled")).toBe(true);
    const patchRequests = requests.filter((request) => request.method === "PATCH");
    expect(patchRequests).toHaveLength(1);
    const patchRequest = patchRequests.at(0);
    if (patchRequest == null) throw new Error("Assignment update request is missing.");
    if (patchRequest.body == null) throw new Error("Assignment update request body is missing.");
    expect(JSON.parse(patchRequest.body)).toMatchObject({
      displayName: "Lobby Display",
      profileId: "company-pulse",
    });
  });

  it("reconciles assignment fields when a later list response changes the display", async () => {
    const firstAdminApp = {
      [hexclaveAppInternalsSymbol]: {
        sendRequest: async () => jsonResponse({ displays: [display] }),
      },
    };
    const renamedDisplay = { ...display, displayName: "Lobby Display" };
    const secondAdminApp = {
      [hexclaveAppInternalsSymbol]: {
        sendRequest: async () => jsonResponse({ displays: [renamedDisplay] }),
      },
    };
    const rendered = render(<TvDisplayManagement adminApp={firstAdminApp} profiles={[getCompanyPulseProfile()]} />);

    await screen.findByLabelText("Display name for Office Display");
    rendered.rerender(<TvDisplayManagement adminApp={secondAdminApp} profiles={[getCompanyPulseProfile()]} />);

    const input = await screen.findByLabelText("Display name for Lobby Display");
    expect(input).toHaveProperty("value", "Lobby Display");
    expect(screen.getByRole("button", { name: "Assignment Saved" }).hasAttribute("disabled")).toBe(true);
  });
});
