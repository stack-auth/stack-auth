/* cSpell:disable */

import { it } from "../../../../../../helpers";
import { Auth, niceBackendFetch, Project } from "../../../../../backend-helpers";


it("should allow initiating passkey registration", async ({ expect }) => {
  await Project.createAndSwitch({ config: { passkey_enabled: true } });
  await Auth.Password.signUpWithEmail({ noWaitForEmail: true });
  await Auth.Passkey.initiateRegistration();
});


it("should successfully register a passkey", async ({ expect }) => {
  await Project.createAndSwitch({ config: { passkey_enabled: true } });
  await Auth.Password.signUpWithEmail({ noWaitForEmail: true });
  await Auth.Passkey.register();
});


it("should not let you register a passkey if passkey auth is not enabled", async ({ expect }) => {
  await Project.createAndSwitch({ config: { passkey_enabled: false, magic_link_enabled: true } });
  const signUpRes = await Auth.Otp.signIn();

  const response = await niceBackendFetch("/api/v1/auth/passkey/initiate-passkey-registration", {
    method: "POST",
    accessType: "client",
    body: {},
  });

  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "PASSKEY_AUTHENTICATION_NOT_ENABLED",
        "error": "Passkey authentication is not enabled for this project.",
      },
      "headers": Headers {
        "x-stack-known-error": "PASSKEY_AUTHENTICATION_NOT_ENABLED",
        <some fields may have been hidden>,
      },
    }
  `);
});

