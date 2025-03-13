import { expect } from "vitest";
import { it } from "../../../../../helpers";
import { Auth, Project, niceBackendFetch } from "../../../../backend-helpers";
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
