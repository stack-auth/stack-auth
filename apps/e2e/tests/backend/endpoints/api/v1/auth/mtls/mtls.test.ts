/* cSpell:disable */

import { it } from "../../../../../../helpers";
import { Auth, Project, niceBackendFetch } from "../../../../../backend-helpers";

it("should not let you initiate certificate registration if mTLS is not enabled", async ({ expect }) => {
  await Project.createAndSwitch({ config: { mtls_enabled: false, magic_link_enabled: true } });
  await Auth.Otp.signIn();

  const response = await niceBackendFetch("/api/v1/auth/mtls/initiate-mtls-registration", {
    method: "POST",
    accessType: "client",
    body: {},
  });

  expect(response).toMatchInlineSnapshot(`
    NiceResponse {
      "status": 400,
      "body": {
        "code": "MTLS_AUTHENTICATION_NOT_ENABLED",
        "error": "mTLS (client certificate) authentication is not enabled for this project.",
      },
      "headers": Headers {
        "x-stack-known-error": "MTLS_AUTHENTICATION_NOT_ENABLED",
        <some fields may have been hidden>,
      },
    }
  `);
});

it("should register a certificate and then sign in with it", async ({ expect }) => {
  await Project.createAndSwitch({ config: { mtls_enabled: true, magic_link_enabled: true } });
  await Auth.Otp.signIn();

  const { registerRes } = await Auth.Mtls.register({ displayName: "My Laptop" });
  expect(registerRes?.status).toBe(200);
  expect(typeof registerRes?.body.id).toBe("string");
  expect(typeof registerRes?.body.fingerprint).toBe("string");

  const { signInRes } = await Auth.Mtls.signIn();
  expect(signInRes?.status).toBe(200);
  expect(typeof signInRes?.body.access_token).toBe("string");
  expect(typeof signInRes?.body.refresh_token).toBe("string");
  expect(typeof signInRes?.body.user_id).toBe("string");
});

it("should reject sign-in when the challenge is signed with the wrong private key", async ({ expect }) => {
  await Project.createAndSwitch({ config: { mtls_enabled: true, magic_link_enabled: true } });
  await Auth.Otp.signIn();
  await Auth.Mtls.register();

  const { signInRes } = await Auth.Mtls.signIn({ privateKeyPem: Auth.Mtls.TEST_PRIVATE_KEY_2 });
  expect(signInRes?.status).toBe(400);
  expect(signInRes?.body.code).toBe("MTLS_AUTHENTICATION_FAILED");
});

it("should reject sign-in with an unregistered certificate", async ({ expect }) => {
  await Project.createAndSwitch({ config: { mtls_enabled: true, magic_link_enabled: true } });
  await Auth.Otp.signIn();
  // Note: no registration performed.

  const { signInRes } = await Auth.Mtls.signIn();
  expect(signInRes?.status).toBe(400);
  expect(signInRes?.body.code).toBe("MTLS_AUTHENTICATION_FAILED");
});

it("should reject registering the same certificate twice", async ({ expect }) => {
  await Project.createAndSwitch({ config: { mtls_enabled: true, magic_link_enabled: true } });
  await Auth.Otp.signIn();

  const first = await Auth.Mtls.register();
  expect(first.registerRes?.status).toBe(200);

  const second = await Auth.Mtls.register();
  expect(second.registerRes?.status).toBe(400);
  expect(second.registerRes?.body.code).toBe("MTLS_CERTIFICATE_ALREADY_REGISTERED");
});

it("should reject registration when the challenge signature doesn't match the certificate", async ({ expect }) => {
  await Project.createAndSwitch({ config: { mtls_enabled: true, magic_link_enabled: true } });
  await Auth.Otp.signIn();

  // Sign the registration challenge with a key that doesn't correspond to the certificate.
  const { registerRes } = await Auth.Mtls.register({ privateKeyPem: Auth.Mtls.TEST_PRIVATE_KEY_2 });
  expect(registerRes?.status).toBe(400);
  expect(registerRes?.body.code).toBe("MTLS_PROOF_OF_POSSESSION_FAILED");
});

it("should list and revoke registered certificates", async ({ expect }) => {
  await Project.createAndSwitch({ config: { mtls_enabled: true, magic_link_enabled: true, credential_enabled: true } });
  await Auth.Otp.signIn();
  const { registerRes } = await Auth.Mtls.register();
  const certId = registerRes?.body.id;

  const listRes = await niceBackendFetch("/api/v1/auth/mtls/certificates", { accessType: "client" });
  expect(listRes.status).toBe(200);
  expect(listRes.body.certificates).toHaveLength(1);

  // The certificate is the only auth method besides OTP, so revoking it is allowed.
  const deleteRes = await niceBackendFetch(`/api/v1/auth/mtls/certificates/${certId}`, {
    method: "DELETE",
    accessType: "client",
  });
  expect(deleteRes.status).toBe(200);

  const listAfter = await niceBackendFetch("/api/v1/auth/mtls/certificates", { accessType: "client" });
  expect(listAfter.body.certificates).toHaveLength(0);
});
