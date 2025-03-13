import { wait } from "@stackframe/stack-shared/dist/utils/promises";
import { it } from "../../../../helpers";
import { Auth, Project, backendContext, createMailbox, niceBackendFetch } from "../../../backend-helpers";

it("should return metrics data", async ({ expect }) => {
  await Project.createAndSwitch({
    config: {
      magic_link_enabled: true,
    }
  });

  await wait(3000);  // the event log is async, so let's give it some time to be written to the DB

  const response = await niceBackendFetch("/api/v1/internal/metrics", { accessType: 'admin' });
  expect(response).toMatchSnapshot(`metrics_result_no_users`);
});

it("should return metrics data with users", async ({ expect }) => {
  await Project.createAndSwitch({
    config: {
      magic_link_enabled: true,
    }
  });

  const mailboxes = new Array(10).fill(null).map(() => createMailbox());

  backendContext.set({ mailbox: mailboxes[0], ipData: { country: "AQ", ipAddress: "127.0.0.1", city: "[placeholder city]", region: "NQ", latitude: 68, longitude: 30, tzIdentifier: "Europe/Zurich" } });
  await Auth.Otp.signIn();

  for (const mailbox of mailboxes) {
    backendContext.set({ mailbox, ipData: undefined });
    await Auth.Otp.signIn();
  }
  backendContext.set({ mailbox: mailboxes[8] });
  await Auth.Otp.signIn();
  const deleteResponse = await niceBackendFetch("/api/v1/users/me", {
    accessType: "server",
    method: "DELETE",
  });
  expect(deleteResponse.status).toBe(200);
  backendContext.set({ userAuth: { ...backendContext.value.userAuth, accessToken: undefined } });

  backendContext.set({ mailbox: mailboxes[1], ipData: { country: "CH", ipAddress: "127.0.0.1", city: "Zurich", region: "ZH", latitude: 47.3769, longitude: 8.5417, tzIdentifier: "Europe/Zurich" } });
  await Auth.Otp.signIn();
  backendContext.set({ mailbox: mailboxes[1], ipData: { country: "AQ", ipAddress: "127.0.0.1", city: "[placeholder city]", region: "NQ", latitude: 68, longitude: 30, tzIdentifier: "Europe/Zurich" } });
  await Auth.Otp.signIn();
  backendContext.set({ mailbox: mailboxes[2], ipData: { country: "CH", ipAddress: "127.0.0.1", city: "Zurich", region: "ZH", latitude: 47.3769, longitude: 8.5417, tzIdentifier: "Europe/Zurich" } });
  await Auth.Otp.signIn();

  await wait(3000);  // the event log is async, so let's give it some time to be written to the DB

  const response = await niceBackendFetch("/api/v1/internal/metrics", { accessType: 'admin' });
  expect(response).toMatchSnapshot();
}, {
  timeout: 120_000,
});

it("should not work for non-admins", async ({ expect }) => {
  await Project.createAndSwitch({
    config: {
      magic_link_enabled: true,
    }
  });

  await Auth.Otp.signIn();

  await wait(3000);  // the event log is async, so let's give it some time to be written to the DB

  const response = await niceBackendFetch("/api/v1/internal/metrics", { accessType: 'server' });
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 401,
      "body": {
        "code": "INSUFFICIENT_ACCESS_TYPE",
        "details": {
          "actual_access_type": "server",
          "allowed_access_types": ["admin"],
        },
        "error": "The x-stack-access-type header must be 'admin', but was 'server'.",
      },
      "headers": Headers {
        "x-stack-known-error": "INSUFFICIENT_ACCESS_TYPE",
        <some fields may have been hidden>,
      },
    }
  `);
});
