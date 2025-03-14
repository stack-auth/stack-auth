import { expect } from "vitest";
import { it } from "../../../../../helpers";
import { Auth, Project, backendContext, niceBackendFetch } from "../../../../backend-helpers";
import { env } from "node:process";

it("should send email digest if there are failed emails", async () => {
  const { adminAccessToken } = await Project.createAndSwitch({
    config: {
      magic_link_enabled: true,
    },
  });

  await Auth.Otp.signIn();

  const response = await niceBackendFetch("/api/latest/cron/send-email-digest", {
    method: "GET",
    accessType: "admin",
    headers: {
      'authorization': `Bearer cron-secret-placeholder`,
      'x-stack-admin-access-token': adminAccessToken,
    },
  });


  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "success": true },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});

it("should send email digest if there are failed emails 2", async () => {
  const { adminAccessToken } = await Project.createAndSwitch({
    config: {
      magic_link_enabled: true,
      email_config: {
        type: 'standard',
        sender_email: 'not-actually-a-real-server@example.com',
        sender_name: 'Test',
        host: 'smtp-fail.example.com',
        port: 587,
        username: 'test',
        password: 'test',
      },
    },
  });
  // sign in a user into internal first / store the user id / 

  await expect(Auth.Otp.signIn()).rejects.toThrow();

  const response = await niceBackendFetch("/api/latest/cron/send-email-digest", {
    method: "GET",
    accessType: "admin",
    headers: {
      'authorization': `Bearer cron-secret-placeholder`,
      'x-stack-admin-access-token': adminAccessToken,
    },
  });


  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": { "success": true },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  const mailbox = backendContext.value.mailbox;
  const messages = await mailbox.fetchMessages({ noBody: true });
  expect(messages).toMatchInlineSnapshot(`[]`);
});

