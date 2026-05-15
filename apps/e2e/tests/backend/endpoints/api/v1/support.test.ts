import { STACK_BACKEND_BASE_URL, it, niceFetch } from "../../../../helpers";
import { Auth, InternalProjectKeys, Project, backendContext, bumpEmailAddress, niceBackendFetch } from "../../../backend-helpers";

const supportConversationsPath = "/api/v1/internal/dogfood/support/conversations";

it("current user can create and reply to a conversation", async ({ expect }) => {
  await Auth.Otp.signIn();

  const createResponse = await niceBackendFetch(supportConversationsPath, {
    accessType: "client",
    method: "POST",
    body: {
      subject: "Can't sign in on mobile",
      message: "The login flow loops back to the sign-in screen on iOS Safari.",
    },
  });
  expect(createResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "conversation_id": "<stripped UUID>" },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  const listResponse = await niceBackendFetch(supportConversationsPath, {
    accessType: "client",
  });
  listResponse.body.conversations[0].last_activity_at = "<stripped ISO>";
  listResponse.body.conversations[0].metadata.last_customer_reply_at = "<stripped ISO>";
  expect(listResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "conversations": [
          {
            "conversation_id": "<stripped UUID>",
            "last_activity_at": "<stripped ISO>",
            "last_message_type": "message",
            "metadata": {
              "assigned_to_display_name": null,
              "assigned_to_user_id": null,
              "first_response_at": null,
              "first_response_due_at": null,
              "last_agent_reply_at": null,
              "last_customer_reply_at": "<stripped ISO>",
              "next_response_due_at": null,
              "tags": [],
            },
            "preview": "The login flow loops back to the sign-in screen on iOS Safari.",
            "priority": "normal",
            "source": "chat",
            "status": "open",
            "subject": "Can't sign in on mobile",
            "team_id": null,
            "user_display_name": null,
            "user_id": "<stripped UUID>",
            "user_primary_email": "default-mailbox--<stripped UUID>@stack-generated.example.com",
            "user_profile_image_url": null,
          },
        ],
        "has_more": false,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  const detailResponse = await niceBackendFetch(`${supportConversationsPath}/${createResponse.body.conversation_id}`, {
    accessType: "client",
  });
  detailResponse.body.conversation.last_activity_at = "<stripped ISO>";
  detailResponse.body.conversation.metadata.last_customer_reply_at = "<stripped ISO>";
  for (const message of detailResponse.body.messages) {
    message.created_at = "<stripped ISO>";
  }
  expect(detailResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "conversation": {
          "conversation_id": "<stripped UUID>",
          "last_activity_at": "<stripped ISO>",
          "last_message_type": "message",
          "metadata": {
            "assigned_to_display_name": null,
            "assigned_to_user_id": null,
            "first_response_at": null,
            "first_response_due_at": null,
            "last_agent_reply_at": null,
            "last_customer_reply_at": "<stripped ISO>",
            "next_response_due_at": null,
            "tags": [],
          },
          "preview": "The login flow loops back to the sign-in screen on iOS Safari.",
          "priority": "normal",
          "source": "chat",
          "status": "open",
          "subject": "Can't sign in on mobile",
          "team_id": null,
          "user_display_name": null,
          "user_id": "<stripped UUID>",
          "user_primary_email": "default-mailbox--<stripped UUID>@stack-generated.example.com",
          "user_profile_image_url": null,
        },
        "messages": [
          {
            "attachments": [],
            "body": "The login flow loops back to the sign-in screen on iOS Safari.",
            "conversation_id": "<stripped UUID>",
            "created_at": "<stripped ISO>",
            "id": "<stripped UUID>",
            "message_type": "message",
            "metadata": null,
            "priority": "normal",
            "sender": {
              "display_name": null,
              "id": "<stripped UUID>",
              "primary_email": "default-mailbox--<stripped UUID>@stack-generated.example.com",
              "type": "user",
            },
            "source": "chat",
            "status": "open",
            "subject": "Can't sign in on mobile",
            "team_id": null,
            "user_id": "<stripped UUID>",
          },
        ],
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  const replyResponse = await niceBackendFetch(`${supportConversationsPath}/${createResponse.body.conversation_id}`, {
    accessType: "client",
    method: "PATCH",
    body: {
      message: "It also reproduces after clearing cookies.",
    },
  });
  replyResponse.body.conversation.last_activity_at = "<stripped ISO>";
  replyResponse.body.conversation.metadata.last_customer_reply_at = "<stripped ISO>";
  for (const message of replyResponse.body.messages) {
    message.created_at = "<stripped ISO>";
  }
  expect(replyResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "conversation": {
          "conversation_id": "<stripped UUID>",
          "last_activity_at": "<stripped ISO>",
          "last_message_type": "message",
          "metadata": {
            "assigned_to_display_name": null,
            "assigned_to_user_id": null,
            "first_response_at": null,
            "first_response_due_at": null,
            "last_agent_reply_at": null,
            "last_customer_reply_at": "<stripped ISO>",
            "next_response_due_at": null,
            "tags": [],
          },
          "preview": "It also reproduces after clearing cookies.",
          "priority": "normal",
          "source": "chat",
          "status": "open",
          "subject": "Can't sign in on mobile",
          "team_id": null,
          "user_display_name": null,
          "user_id": "<stripped UUID>",
          "user_primary_email": "default-mailbox--<stripped UUID>@stack-generated.example.com",
          "user_profile_image_url": null,
        },
        "messages": [
          {
            "attachments": [],
            "body": "The login flow loops back to the sign-in screen on iOS Safari.",
            "conversation_id": "<stripped UUID>",
            "created_at": "<stripped ISO>",
            "id": "<stripped UUID>",
            "message_type": "message",
            "metadata": null,
            "priority": "normal",
            "sender": {
              "display_name": null,
              "id": "<stripped UUID>",
              "primary_email": "default-mailbox--<stripped UUID>@stack-generated.example.com",
              "type": "user",
            },
            "source": "chat",
            "status": "open",
            "subject": "Can't sign in on mobile",
            "team_id": null,
            "user_id": "<stripped UUID>",
          },
          {
            "attachments": [],
            "body": "It also reproduces after clearing cookies.",
            "conversation_id": "<stripped UUID>",
            "created_at": "<stripped ISO>",
            "id": "<stripped UUID>",
            "message_type": "message",
            "metadata": null,
            "priority": "normal",
            "sender": {
              "display_name": null,
              "id": "<stripped UUID>",
              "primary_email": "default-mailbox--<stripped UUID>@stack-generated.example.com",
              "type": "user",
            },
            "source": "chat",
            "status": "open",
            "subject": "Can't sign in on mobile",
            "team_id": null,
            "user_id": "<stripped UUID>",
          },
        ],
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("users cannot access conversations owned by another user", async ({ expect }) => {
  await Auth.Otp.signIn();

  const createResponse = await niceBackendFetch(supportConversationsPath, {
    accessType: "client",
    method: "POST",
    body: {
      subject: "Need billing help",
      message: "I need a copy of my invoice.",
    },
  });

  await bumpEmailAddress();
  await Auth.Otp.signIn();

  const listResponse = await niceBackendFetch(supportConversationsPath, {
    accessType: "client",
  });
  expect(listResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "conversations": [],
        "has_more": false,
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  const detailResponse = await niceBackendFetch(`${supportConversationsPath}/${createResponse.body.conversation_id}`, {
    accessType: "client",
  });
  expect(detailResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 404,
      "body": "Conversation not found.",
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("deleting a user preserves their conversations with historical user IDs", async ({ expect }) => {
  const { projectId, adminAccessToken } = await Project.createAndSwitch({
    config: {
      magic_link_enabled: true,
    },
  });
  await Auth.Otp.signIn();

  const userResponse = await niceBackendFetch("/api/v1/users/me", {
    accessType: "server",
  });
  const userId = userResponse.body.id;
  const userEmail = userResponse.body.primary_email;

  const createResponse = await niceBackendFetch(supportConversationsPath, {
    accessType: "client",
    method: "POST",
    body: {
      subject: "Please preserve this conversation",
      message: "This user-identifying sender snapshot should be preserved.",
    },
  });
  expect(createResponse.status).toBe(200);
  const conversationId = createResponse.body.conversation_id;

  const deleteResponse = await niceBackendFetch(`/api/v1/users/${userId}`, {
    accessType: "server",
    method: "DELETE",
  });
  expect(deleteResponse).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "success": true },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  backendContext.set({
    projectKeys: InternalProjectKeys,
    userAuth: {
      accessToken: adminAccessToken,
    },
  });
  const detailResponse = await niceFetch(new URL(`/api/v1/internal/conversations/${conversationId}?projectId=${encodeURIComponent(projectId)}`, STACK_BACKEND_BASE_URL), {
    headers: {
      "x-stack-access-type": "client",
      "x-stack-project-id": InternalProjectKeys.projectId,
      "x-stack-publishable-client-key": InternalProjectKeys.publishableClientKey,
      "x-stack-access-token": adminAccessToken,
      "x-stack-allow-anonymous-user": "true",
    },
  });

  expect(detailResponse.status).toBe(200);
  expect(detailResponse.body.conversation).toMatchObject({
    conversationId,
    userId,
    userDisplayName: null,
    userPrimaryEmail: null,
    subject: "Please preserve this conversation",
  });
  expect(detailResponse.body.messages).toHaveLength(1);
  expect(detailResponse.body.messages[0]).toMatchObject({
    conversationId,
    userId,
    body: "This user-identifying sender snapshot should be preserved.",
    sender: {
      type: "user",
      id: userId,
      displayName: null,
      primaryEmail: userEmail,
    },
  });
  expect(JSON.stringify(detailResponse.body)).toContain(userId);
  expect(JSON.stringify(detailResponse.body)).toContain(userEmail);
});
