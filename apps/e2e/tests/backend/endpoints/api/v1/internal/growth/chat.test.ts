import { randomUUID } from "node:crypto";
import { describe } from "vitest";
import { it } from "../../../../../../helpers";
import { Project, niceBackendFetch } from "../../../../../backend-helpers";
import { createUnlockedGrowthProject } from "./growth-helpers";

const ADMIN_BASE = "/api/latest/internal/growth";

// Non-streaming growth chat e2e: auth/enablement gating, conversation listing/detail semantics,
// and — the load-bearing one — PERSIST-AFTER-PROXY: nothing (no conversation row, no messages) may
// be persisted when the Eve proxy call fails. This file must NOT use mock-eve (its fixed port
// belongs to growth-workflows.test.ts exclusively); every Eve /chat call from here either hits nothing
// (connection refused) or, when growth-workflows.test.ts happens to run concurrently in another
// worker, its mock (which answers with the fire-and-forget {"accepted":true} ack, a body the chat
// proxy treats as malformed). Both cases surface as the same retryable 502, so the suite stays
// deterministic either way. The happy path (successful turn -> conversation + both messages
// persisted -> chunk stream) needs a real Eve returning a well-formed assistant UIMessage and is
// therefore NOT covered here; the pure wire-shaping helpers are pinned by the backend's
// lib/growth/chat.test.ts instead (documented coverage gap for the DB-append path).

type ConversationList = { conversations: { id: string, title: string }[] };

async function listConversations(): Promise<{ status: number, body: ConversationList }> {
  const response = await niceBackendFetch(`${ADMIN_BASE}/chat/conversations`, { accessType: "admin" });
  return { status: response.status, body: response.body as ConversationList };
}

describe("internal growth chat (no mock Eve)", { timeout: 90_000 }, () => {
  it("rejects growth-disabled projects and non-admin access", async ({ expect }) => {
    await Project.createAndSwitch();

    // App not enabled: even admin requests are rejected with a 400 on every chat route.
    const disabledChat = await niceBackendFetch(`${ADMIN_BASE}/chat`, { accessType: "admin", method: "POST", body: { message: "hello" } });
    expect(disabledChat.status).toBe(400);
    const disabledList = await niceBackendFetch(`${ADMIN_BASE}/chat/conversations`, { accessType: "admin" });
    expect(disabledList.status).toBe(400);
    const disabledDetail = await niceBackendFetch(`${ADMIN_BASE}/chat/conversations/${randomUUID()}`, { accessType: "admin" });
    expect(disabledDetail.status).toBe(400);

    await Project.updateConfig({ "apps.installed.gtm.enabled": true });

    // Client access is never allowed on the admin chat surface.
    const clientChat = await niceBackendFetch(`${ADMIN_BASE}/chat`, { accessType: "client", method: "POST", body: { message: "hello" } });
    expect(clientChat.status).toBe(401);
    const clientList = await niceBackendFetch(`${ADMIN_BASE}/chat/conversations`, { accessType: "client" });
    expect(clientList.status).toBe(401);
    const clientDetail = await niceBackendFetch(`${ADMIN_BASE}/chat/conversations/${randomUUID()}`, { accessType: "client" });
    expect(clientDetail.status).toBe(401);
  });

  it("validates the request, 404s unknown conversations, and persists NOTHING when Eve is unreachable", async ({ expect }) => {
    // Released: chat speaks from the full growth context, so it stays locked until the customer's
    // first report is published. Everything this test is actually about happens after that gate.
    await createUnlockedGrowthProject();

    // Empty and missing messages are schema-rejected before anything happens.
    const missingMessage = await niceBackendFetch(`${ADMIN_BASE}/chat`, { accessType: "admin", method: "POST", body: {} });
    expect(missingMessage.status).toBe(400);
    const emptyMessage = await niceBackendFetch(`${ADMIN_BASE}/chat`, { accessType: "admin", method: "POST", body: { message: "" } });
    expect(emptyMessage.status).toBe(400);

    // Unknown and malformed conversation ids are both a 404 (malformed ids must not become 500s),
    // checked BEFORE the Eve proxy call — so these return fast even with no Eve around.
    const unknownConversation = await niceBackendFetch(`${ADMIN_BASE}/chat`, {
      accessType: "admin",
      method: "POST",
      body: { conversation_id: randomUUID(), message: "resume please" },
    });
    expect(unknownConversation.status).toBe(404);
    const malformedConversation = await niceBackendFetch(`${ADMIN_BASE}/chat`, {
      accessType: "admin",
      method: "POST",
      body: { conversation_id: "not-a-uuid", message: "resume please" },
    });
    expect(malformedConversation.status).toBe(404);
    const unknownDetail = await niceBackendFetch(`${ADMIN_BASE}/chat/conversations/${randomUUID()}`, { accessType: "admin" });
    expect(unknownDetail.status).toBe(404);
    const malformedDetail = await niceBackendFetch(`${ADMIN_BASE}/chat/conversations/not-a-uuid`, { accessType: "admin" });
    expect(malformedDetail.status).toBe(404);

    // PERSIST-AFTER-PROXY: no Eve is reachable from this suite, so the first turn fails with the
    // retryable 502 — and because the chat persists only after a successful proxy call (the
    // deliberate opposite of the interview's answer-first rule), NOTHING may exist afterwards: no
    // half-created conversation row, no dangling user message.
    await expect(niceBackendFetch(`${ADMIN_BASE}/chat`, {
      accessType: "admin",
      method: "POST",
      body: { message: "Why did signups drop last week?" },
    })).rejects.toThrow(/API threw ISE.*502/);
    const afterFailure = await listConversations();
    expect(afterFailure.status).toBe(200);
    expect(afterFailure.body).toEqual({ conversations: [] });

    // Retrying fails the same way and still leaves nothing behind (retries are idempotent from the
    // user's point of view precisely because nothing was persisted).
    await expect(niceBackendFetch(`${ADMIN_BASE}/chat`, {
      accessType: "admin",
      method: "POST",
      body: { message: "Why did signups drop last week?" },
    })).rejects.toThrow(/API threw ISE.*502/);
    const afterRetry = await listConversations();
    expect(afterRetry.body).toEqual({ conversations: [] });
  });

  // The timeout is raised over the default because this test onboards TWO growth projects (every
  // other test here onboards one), and growth onboarding is the expensive part of the fixture: it
  // seeds the canonical workflows through the sandbox. Under the full e2e suite the sibling growth
  // tests already land at ~60s, so the default timeout leaves this one no headroom even though it
  // runs in a couple of seconds in isolation.
  it("keeps growth chat conversations isolated per project", { timeout: 90_000 }, async ({ expect }) => {
    // Two growth projects; neither can ever see the other's (empty) conversation list, and a
    // conversation id from one project 404s on the other even if it existed. With no Eve available
    // no conversation can actually be created here, so this pins the empty-list scoping plus the
    // cross-project 404 shape.
    await createUnlockedGrowthProject();
    const firstList = await listConversations();
    expect(firstList.body).toEqual({ conversations: [] });

    await createUnlockedGrowthProject();
    const secondList = await listConversations();
    expect(secondList.body).toEqual({ conversations: [] });
    const crossProject = await niceBackendFetch(`${ADMIN_BASE}/chat/conversations/${randomUUID()}`, { accessType: "admin" });
    expect(crossProject.status).toBe(404);
  });
});
