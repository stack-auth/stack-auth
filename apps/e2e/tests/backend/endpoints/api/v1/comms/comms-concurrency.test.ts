import { generateSecureRandomString } from "@hexclave/shared/dist/utils/crypto";
import { it } from "../../../../../helpers";
import { Project, createMailbox, niceBackendFetch } from "../../../../backend-helpers";

/**
 * Concurrent duplicate inbound delivery and competing merge operations.
 * These exercise the deterministic lock + idempotency paths in contacts/comms services.
 */
it("concurrent idempotent message ingest returns the same message id", async ({ expect }) => {
  await Project.createAndSwitch();
  const mailbox = createMailbox();
  const externalMessageId = `concurrent-${generateSecureRandomString()}`;
  const body = {
    direction: "inbound" as const,
    adapter_key: "email:test",
    external_message_id: externalMessageId,
    occurred_at_millis: Date.now(),
    payload: {
      type: "email" as const,
      version: 1 as const,
      subject: "Concurrent",
      text_body: "hello",
      html_body: null,
      amp_html_body: null,
      headers: [],
    },
    participants: [
      {
        role: "from" as const,
        position: 0,
        address_snapshot: mailbox.emailAddress,
        display_name_snapshot: null,
      },
    ],
  };

  const [a, b, c] = await Promise.all([
    niceBackendFetch("/api/v1/comms/messages", { accessType: "server", method: "POST", body }),
    niceBackendFetch("/api/v1/comms/messages", { accessType: "server", method: "POST", body }),
    niceBackendFetch("/api/v1/comms/messages", { accessType: "server", method: "POST", body }),
  ]);

  expect(a.status).toBe(201);
  expect(b.status).toBe(201);
  expect(c.status).toBe(201);
  expect(a.body.id).toBe(b.body.id);
  expect(b.body.id).toBe(c.body.id);

  const listed = await niceBackendFetch(`/api/v1/comms/conversations/${a.body.conversation_id}/messages`, {
    accessType: "server",
  });
  expect(listed.status).toBe(200);
  expect(listed.body.items).toHaveLength(1);
});

it("concurrent contact merges with distinct keys serialize without cycle", async ({ expect }) => {
  await Project.createAndSwitch();
  const createContact = async (label: string) => {
    const mailbox = createMailbox();
    const response = await niceBackendFetch("/api/v1/contacts", {
      accessType: "server",
      method: "POST",
      body: {
        display_name: label,
        channels: [{ type: "email", value: mailbox.emailAddress, is_primary: true }],
      },
    });
    expect(response.status).toBe(201);
    return response.body.id as string;
  };

  const aId = await createContact("A");
  const bId = await createContact("B");
  const cId = await createContact("C");

  const [mergeAb, mergeBc] = await Promise.all([
    niceBackendFetch(`/api/v1/contacts/${aId}/merge`, {
      accessType: "server",
      method: "POST",
      body: {
        target_contact_id: bId,
        idempotency_key: `ab-${generateSecureRandomString()}`,
      },
    }),
    niceBackendFetch(`/api/v1/contacts/${bId}/merge`, {
      accessType: "server",
      method: "POST",
      body: {
        target_contact_id: cId,
        idempotency_key: `bc-${generateSecureRandomString()}`,
      },
    }),
  ]);

  // Exactly one succeeds. The second would create a merge chain, regardless of
  // which transaction acquires the sorted contact locks first.
  expect([mergeAb.status, mergeBc.status].every((s) => s === 200 || s === 400 || s === 409)).toBe(true);
  expect([mergeAb.status, mergeBc.status].filter((s) => s === 200)).toHaveLength(1);

  const [a, b, c] = await Promise.all([
    niceBackendFetch(`/api/v1/contacts/${aId}`, { accessType: "server" }),
    niceBackendFetch(`/api/v1/contacts/${bId}`, { accessType: "server" }),
    niceBackendFetch(`/api/v1/contacts/${cId}`, { accessType: "server" }),
  ]);
  expect(a.status).toBe(200);
  expect(b.status).toBe(200);
  expect(c.status).toBe(200);

  // At least one merge completed; the graph remains acyclic (no contact points at itself).
  for (const contact of [a.body, b.body, c.body]) {
    expect(contact.merged_into_contact_id === null || contact.merged_into_contact_id !== contact.id).toBe(true);
  }
});

it("concurrent delivery attempts receive distinct consecutive numbers", async ({ expect }) => {
  await Project.createAndSwitch();
  const mailbox = createMailbox();
  const messageResponse = await niceBackendFetch("/api/v1/comms/messages", {
    accessType: "server",
    method: "POST",
    body: {
      direction: "outbound",
      adapter_key: "email:test",
      external_message_id: `delivery-${generateSecureRandomString()}`,
      occurred_at_millis: Date.now(),
      payload: {
        type: "email",
        version: 1,
        subject: "Concurrent delivery",
        text_body: "hello",
        html_body: null,
        amp_html_body: null,
        headers: [],
      },
      participants: [{
        role: "to",
        position: 0,
        address_snapshot: mailbox.emailAddress,
        display_name_snapshot: null,
      }],
    },
  });
  expect(messageResponse.status).toBe(201);

  const deliveryResponse = await niceBackendFetch(`/api/v1/comms/messages/${messageResponse.body.id}/deliveries`, {
    accessType: "server",
    method: "POST",
    body: { address_snapshot: mailbox.emailAddress },
  });
  expect(deliveryResponse.status).toBe(201);

  const attempts = await Promise.all([0, 1, 2].map((index) =>
    niceBackendFetch(`/api/v1/comms/deliveries/${deliveryResponse.body.id}/attempts`, {
      accessType: "server",
      method: "POST",
      body: {
        outcome: "success",
        provider_response: { index },
      },
    })
  ));

  expect(attempts.map((response) => response.status)).toEqual([201, 201, 201]);
  expect(attempts.map((response) => response.body.attempt.attempt_number).sort((a, b) => a - b)).toEqual([1, 2, 3]);
});
