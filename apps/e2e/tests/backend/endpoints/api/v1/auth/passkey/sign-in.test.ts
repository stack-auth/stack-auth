/* cSpell:disable */

import { it } from "../../../../../../helpers";
import { Auth, niceBackendFetch, Project } from "../../../../../backend-helpers";


it("should allow initiating passkey authentication", async ({ expect }) => {
  await Project.createAndSwitch({ config: { passkey_enabled: true, magic_link_enabled: true } });
  const res = await Auth.Password.signUpWithEmail();
  const response = await niceBackendFetch("/api/v1/auth/passkey/initiate-passkey-authentication", {
    method: "POST",
    accessType: "client",
    body: {},
  });
  response.body.code = "<stripped code>";
  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "code": "<stripped code>",
        "options_json": {
          "allowCredentials": [],
          "challenge": "TU9DSw",
          "rpId": "THIS_VALUE_WILL_BE_REPLACED.example.com",
          "timeout": 60000,
          "userVerification": "preferred",
        },
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);
});


it("should successfully sign in with a passkey", async ({ expect }) => {
  await Project.createAndSwitch({ config: { passkey_enabled: true } });
  const res = await Auth.Password.signUpWithEmail();

  const expectedUserId = res.userId;
  await Auth.Passkey.register();

  await Auth.signOut();
  const response_initiation = await niceBackendFetch("/api/v1/auth/passkey/initiate-passkey-authentication", {
    method: "POST",
    accessType: "client",
    body: {},
  });

  const { code } = response_initiation.body;

  const response = await niceBackendFetch("/api/v1/auth/passkey/sign-in", {
    method: "POST",
    accessType: "client",
    body: {
      "authentication_response": {
        "id": "BBYYB_DKzPZHm1o6ILGo6Sk_cBc",
        "rawId": "BBYYB_DKzPZHm1o6ILGo6Sk_cBc",
        "response": {
          "authenticatorData": "SZYN5YgOjGh0NBcPZHZgW4_krrmihjLHmVzzuoMdl2MdAAAAAA",
          "clientDataJSON": "eyJ0eXBlIjoid2ViYXV0aG4uZ2V0IiwiY2hhbGxlbmdlIjoiVFU5RFN3Iiwib3JpZ2luIjoiaHR0cDovL2xvY2FsaG9zdDo4MTAzIiwiY3Jvc3NPcmlnaW4iOmZhbHNlLCJvdGhlcl9rZXlzX2Nhbl9iZV9hZGRlZF9oZXJlIjoiZG8gbm90IGNvbXBhcmUgY2xpZW50RGF0YUpTT04gYWdhaW5zdCBhIHRlbXBsYXRlLiBTZWUgaHR0cHM6Ly9nb28uZ2wveWFiUGV4In0",
          "signature": "MEUCIQDPFYXxm-ALPZVuP4YdXBr1INrfObXR6hukxTttYNnegAIgEfy5MlnIi10VwmilOmuT1TuuDBLw9GDSv9DQuIRZXRE",
          "userHandle": "YzE3YzJjNjMtMTkxZi00MWZmLTlkNjEtYzBjOGVlMmVlMGQ0"
        },
        "type": "public-key",
        "clientExtensionResults": {},
        "authenticatorAttachment": "platform"
      },
      "code": code,
    },
  });

  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 200,
      "body": {
        "access_token": <stripped field 'access_token'>,
        "is_new_user": false,
        "refresh_token": <stripped field 'refresh_token'>,
        "user_id": "<stripped UUID>",
      },
      "headers": Headers { <some fields may have been hidden> },
    }
  `);

  expect(response.body.user_id).toBe(expectedUserId);
});

it("should fail if passkey does not exist", async ({ expect }) => {
  await Project.createAndSwitch({ config: { passkey_enabled: true } });
  const res = await Auth.Password.signUpWithEmail();
  await Auth.Passkey.register();
  const response_initiation = await niceBackendFetch("/api/v1/auth/passkey/initiate-passkey-authentication", {
    method: "POST",
    accessType: "client",
    body: {},
  });

  const { code } = response_initiation.body;

  const response = await niceBackendFetch("/api/v1/auth/passkey/sign-in", {
    method: "POST",
    accessType: "client",
    body: {
      "authentication_response": {
        "id": "does-not-exist",
        "rawId": "does-not-exist",
        "response": {
          "authenticatorData": "SZYN5YgOjGh0NBcPZHZgW4_krrmihjLHmVzzuoMdl2MdAAAAAA",
          "clientDataJSON": "eyJ0eXBlIjoid2ViYXV0aG4uZ2V0IiwiY2hhbGxlbmdlIjoiVFU5RFN3Iiwib3JpZ2luIjoiaHR0cDovL2xvY2FsaG9zdDo4MTAzIiwiY3Jvc3NPcmlnaW4iOmZhbHNlLCJvdGhlcl9rZXlzX2Nhbl9iZV9hZGRlZF9oZXJlIjoiZG8gbm90IGNvbXBhcmUgY2xpZW50RGF0YUpTT04gYWdhaW5zdCBhIHRlbXBsYXRlLiBTZWUgaHR0cHM6Ly9nb28uZ2wveWFiUGV4In0",
          "signature": "MEUCIQDPFYXxm-ALPZVuP4YdXBr1INrfObXR6hukxTttYNnegAIgEfy5MlnIi10VwmilOmuT1TuuDBLw9GDSv9DQuIRZXRE",
          "userHandle": "YzE3YzJjNjMtMTkxZi00MWZmLTlkNjEtYzBjOGVlMmVlMGQ0"
        },
        "type": "public-key",
        "clientExtensionResults": {},
        "authenticatorAttachment": "platform"
      },
      "code": code,
    },
  });

  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "PASSKEY_AUTHENTICATION_FAILED",
        "error": "Passkey not found",
      },
      "headers": Headers {
        "x-stack-known-error": "PASSKEY_AUTHENTICATION_FAILED",
        <some fields may have been hidden>,
      },
    }
  `);
});

