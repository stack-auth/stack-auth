import { generateSecureRandomString } from "@hexclave/shared/dist/utils/crypto";
import { it } from "../../../../../helpers";
import { Project, User, createMailbox, niceBackendFetch } from "../../../../backend-helpers";

async function createContactWithEmailChannel(email: string, displayName?: string) {
  const response = await niceBackendFetch("/api/v1/contacts", {
    accessType: "server",
    method: "POST",
    body: {
      display_name: displayName ?? null,
      channels: [
        {
          type: "email",
          value: email,
          is_primary: true,
          is_verified: true,
        },
      ],
    },
  });
  return response;
}

it("creates a contact with an email channel on the server", async ({ expect }) => {
  await Project.createAndSwitch();
  const mailbox = createMailbox();

  const response = await createContactWithEmailChannel(mailbox.emailAddress, "Test Contact");
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 201,
      "body": {
        "channels": [
          {
            "contact_id": "<stripped UUID>",
            "created_at_millis": <stripped field 'created_at_millis'>,
            "display_value": "mailbox-1--<stripped UUID>@stack-generated.example.com",
            "id": "<stripped UUID>",
            "is_primary": true,
            "is_verified": true,
            "metadata": null,
            "type": "email",
            "updated_at_millis": <stripped field 'updated_at_millis'>,
            "value": "mailbox-1--<stripped UUID>@stack-generated.example.com",
            "verified_at_millis": <stripped field 'verified_at_millis'>,
          },
        ],
        "client_metadata": null,
        "client_read_only_metadata": null,
        "created_at_millis": <stripped field 'created_at_millis'>,
        "display_name": "Test Contact",
        "id": "<stripped UUID>",
        "is_user_backed": false,
        "merged_at_millis": null,
        "merged_into_contact_id": null,
        "profile_image_url": null,
        "server_metadata": null,
        "updated_at_millis": <stripped field 'updated_at_millis'>,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("gets, lists, and updates a contact", async ({ expect }) => {
  await Project.createAndSwitch();
  const mailbox = createMailbox();
  const createResponse = await createContactWithEmailChannel(mailbox.emailAddress, "Original Name");
  const contactId = createResponse.body.id;

  const getResponse = await niceBackendFetch(`/api/v1/contacts/${contactId}`, {
    accessType: "server",
  });
  expect(getResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "channels": [
          {
            "contact_id": "<stripped UUID>",
            "created_at_millis": <stripped field 'created_at_millis'>,
            "display_value": "mailbox-1--<stripped UUID>@stack-generated.example.com",
            "id": "<stripped UUID>",
            "is_primary": true,
            "is_verified": true,
            "metadata": null,
            "type": "email",
            "updated_at_millis": <stripped field 'updated_at_millis'>,
            "value": "mailbox-1--<stripped UUID>@stack-generated.example.com",
            "verified_at_millis": <stripped field 'verified_at_millis'>,
          },
        ],
        "client_metadata": null,
        "client_read_only_metadata": null,
        "created_at_millis": <stripped field 'created_at_millis'>,
        "display_name": "Original Name",
        "id": "<stripped UUID>",
        "is_user_backed": false,
        "merged_at_millis": null,
        "merged_into_contact_id": null,
        "profile_image_url": null,
        "server_metadata": null,
        "updated_at_millis": <stripped field 'updated_at_millis'>,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  const listResponse = await niceBackendFetch("/api/v1/contacts", {
    accessType: "server",
  });
  expect(listResponse.status).toBe(200);
  expect(listResponse.body.is_paginated).toBe(true);
  expect(listResponse.body.items.some((item: { id: string }) => item.id === contactId)).toBe(true);

  const updateResponse = await niceBackendFetch(`/api/v1/contacts/${contactId}`, {
    accessType: "server",
    method: "PATCH",
    body: {
      display_name: "Updated Name",
      server_metadata: { note: "crm" },
    },
  });
  expect(updateResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "channels": [
          {
            "contact_id": "<stripped UUID>",
            "created_at_millis": <stripped field 'created_at_millis'>,
            "display_value": "mailbox-1--<stripped UUID>@stack-generated.example.com",
            "id": "<stripped UUID>",
            "is_primary": true,
            "is_verified": true,
            "metadata": null,
            "type": "email",
            "updated_at_millis": <stripped field 'updated_at_millis'>,
            "value": "mailbox-1--<stripped UUID>@stack-generated.example.com",
            "verified_at_millis": <stripped field 'verified_at_millis'>,
          },
        ],
        "client_metadata": null,
        "client_read_only_metadata": null,
        "created_at_millis": <stripped field 'created_at_millis'>,
        "display_name": "Updated Name",
        "id": "<stripped UUID>",
        "is_user_backed": false,
        "merged_at_millis": null,
        "merged_into_contact_id": null,
        "profile_image_url": null,
        "server_metadata": { "note": "crm" },
        "updated_at_millis": <stripped field 'updated_at_millis'>,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("adds a channel via POST /api/v1/contacts/{id}/channels", async ({ expect }) => {
  await Project.createAndSwitch();
  const primaryMailbox = createMailbox();
  const secondaryMailbox = createMailbox();
  const createResponse = await createContactWithEmailChannel(primaryMailbox.emailAddress);
  const contactId = createResponse.body.id;

  const addChannelResponse = await niceBackendFetch(`/api/v1/contacts/${contactId}/channels`, {
    accessType: "server",
    method: "POST",
    body: {
      type: "email",
      value: secondaryMailbox.emailAddress,
      is_primary: false,
      is_verified: false,
    },
  });
  expect(addChannelResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 201,
      "body": {
        "contact_id": "<stripped UUID>",
        "created_at_millis": <stripped field 'created_at_millis'>,
        "display_value": "mailbox-2--<stripped UUID>@stack-generated.example.com",
        "id": "<stripped UUID>",
        "is_primary": false,
        "is_verified": false,
        "metadata": null,
        "type": "email",
        "updated_at_millis": <stripped field 'updated_at_millis'>,
        "value": "mailbox-2--<stripped UUID>@stack-generated.example.com",
        "verified_at_millis": null,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  const listChannelsResponse = await niceBackendFetch(`/api/v1/contacts/${contactId}/channels`, {
    accessType: "server",
  });
  expect(listChannelsResponse.body.items).toHaveLength(2);
});

it("merges two non-user contacts with idempotent retry", async ({ expect }) => {
  await Project.createAndSwitch();
  const sourceMailbox = createMailbox();
  const targetMailbox = createMailbox();
  const sourceResponse = await createContactWithEmailChannel(sourceMailbox.emailAddress, "Source");
  const targetResponse = await createContactWithEmailChannel(targetMailbox.emailAddress, "Target");
  const sourceContactId = sourceResponse.body.id;
  const targetContactId = targetResponse.body.id;
  const idempotencyKey = `merge-${generateSecureRandomString()}`;

  const mergeResponse = await niceBackendFetch(`/api/v1/contacts/${sourceContactId}/merge`, {
    accessType: "server",
    method: "POST",
    body: {
      target_contact_id: targetContactId,
      idempotency_key: idempotencyKey,
    },
  });
  expect(mergeResponse.status).toBe(200);
  expect(mergeResponse.body.replayed).toBe(false);
  expect(mergeResponse.body.contact.id).toBe(targetContactId);
  const operationId = mergeResponse.body.operation_id;

  const retryMergeResponse = await niceBackendFetch(`/api/v1/contacts/${sourceContactId}/merge`, {
    accessType: "server",
    method: "POST",
    body: {
      target_contact_id: targetContactId,
      idempotency_key: idempotencyKey,
    },
  });
  expect(retryMergeResponse.status).toBe(200);
  expect(retryMergeResponse.body.replayed).toBe(true);
  expect(retryMergeResponse.body.operation_id).toBe(operationId);
  expect(retryMergeResponse.body.contact.id).toBe(targetContactId);
  expect(retryMergeResponse.body.contact.channels).toHaveLength(2);

  const mergedSourceResponse = await niceBackendFetch(`/api/v1/contacts/${sourceContactId}`, {
    accessType: "server",
  });
  expect(mergedSourceResponse.body.merged_into_contact_id).toBe(targetContactId);

  const finalTargetMailbox = createMailbox();
  const finalTargetResponse = await createContactWithEmailChannel(finalTargetMailbox.emailAddress, "Final target");
  const chainedMergeResponse = await niceBackendFetch(`/api/v1/contacts/${targetContactId}/merge`, {
    accessType: "server",
    method: "POST",
    body: {
      target_contact_id: finalTargetResponse.body.id,
      idempotency_key: `merge-chain-${generateSecureRandomString()}`,
    },
  });
  expect(chainedMergeResponse.status).toBe(400);
  expect(chainedMergeResponse.body).toBe("Cannot merge a contact that already has merged source contacts");
});

it("cannot delete or merge a user-backed contact using the user id as contact id", async ({ expect }) => {
  await Project.createAndSwitch();
  const mailbox = createMailbox();
  const { userId } = await User.create({
    primary_email: mailbox.emailAddress,
    primary_email_verified: true,
    display_name: "User Contact",
  });

  const crmMailbox = createMailbox();
  const crmResponse = await createContactWithEmailChannel(crmMailbox.emailAddress);

  const mergeIntoUserResponse = await niceBackendFetch(`/api/v1/contacts/${userId}/merge`, {
    accessType: "server",
    method: "POST",
    body: {
      target_contact_id: crmResponse.body.id,
      idempotency_key: `merge-user-${generateSecureRandomString()}`,
    },
  });
  expect(mergeIntoUserResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": "Cannot merge a user-backed contact as the source. Merge CRM-only contacts into the user-backed contact instead.",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  const deleteUserContactResponse = await niceBackendFetch(`/api/v1/contacts/${userId}`, {
    accessType: "server",
    method: "DELETE",
  });
  expect(deleteUserContactResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": "Cannot delete a user-backed contact. Delete the ProjectUser first; the contact is retained after user deletion.",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("preserves the contact after user deletion", async ({ expect }) => {
  await Project.createAndSwitch();
  const mailbox = createMailbox();
  const { userId } = await User.create({
    primary_email: mailbox.emailAddress,
    primary_email_verified: true,
    display_name: "Persisted Contact",
  });

  const beforeDeleteResponse = await niceBackendFetch(`/api/v1/contacts/${userId}`, {
    accessType: "server",
  });
  expect(beforeDeleteResponse.status).toBe(200);
  expect(beforeDeleteResponse.body.is_user_backed).toBe(true);

  const deleteUserResponse = await niceBackendFetch(`/api/v1/users/${userId}`, {
    accessType: "server",
    method: "DELETE",
  });
  expect(deleteUserResponse.status).toBe(200);

  const afterDeleteResponse = await niceBackendFetch(`/api/v1/contacts/${userId}`, {
    accessType: "server",
  });
  expect(afterDeleteResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "channels": [
          {
            "contact_id": "<stripped UUID>",
            "created_at_millis": <stripped field 'created_at_millis'>,
            "display_value": "mailbox-1--<stripped UUID>@stack-generated.example.com",
            "id": "<stripped UUID>",
            "is_primary": true,
            "is_verified": true,
            "metadata": null,
            "type": "email",
            "updated_at_millis": <stripped field 'updated_at_millis'>,
            "value": "mailbox-1--<stripped UUID>@stack-generated.example.com",
            "verified_at_millis": <stripped field 'verified_at_millis'>,
          },
        ],
        "client_metadata": null,
        "client_read_only_metadata": null,
        "created_at_millis": <stripped field 'created_at_millis'>,
        "display_name": "Persisted Contact",
        "id": "<stripped UUID>",
        "is_user_backed": false,
        "merged_at_millis": null,
        "merged_into_contact_id": null,
        "profile_image_url": null,
        "server_metadata": null,
        "updated_at_millis": <stripped field 'updated_at_millis'>,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});
