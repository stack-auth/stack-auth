import { pick } from "@stackframe/stack-shared/dist/utils/objects";
import { it } from "../helpers";
import { createApp } from "./js-helpers";

it("gets config", async ({ expect }) => {
  const { adminApp } = await createApp();
  const project = await adminApp.getProject();
  const config = await project.getConfig();
  expect(pick(config, ["auth", "users", "teams"])).toMatchInlineSnapshot(`
    {
      "auth": {
        "allowSignUp": true,
        "oauth": {
          "accountMergeStrategy": "link_method",
          "providers": {},
        },
        "otp": { "allowSignIn": false },
        "passkey": { "allowSignIn": false },
        "password": { "allowSignIn": true },
      },
      "teams": {
        "allowClientTeamCreation": false,
        "createPersonalTeamOnSignUp": false,
      },
      "users": { "allowClientUserDeletion": false },
    }
  `);
});

it("updates config", async ({ expect }) => {
  const { adminApp } = await createApp();
  const project = await adminApp.getProject();
  const config = await project.getConfig();
  expect(config['auth']).toMatchInlineSnapshot(`
    {
      "allowSignUp": true,
      "oauth": {
        "accountMergeStrategy": "link_method",
        "providers": {},
      },
      "otp": { "allowSignIn": false },
      "passkey": { "allowSignIn": false },
      "password": { "allowSignIn": true },
    }
  `);

  await project.updateConfig({
    'auth.allowSignUp': false,
  });

  const config2 = await project.getConfig();
  expect(config2['auth']).toMatchInlineSnapshot(`
    {
      "allowSignUp": false,
      "oauth": {
        "accountMergeStrategy": "link_method",
        "providers": {},
      },
      "otp": { "allowSignIn": false },
      "passkey": { "allowSignIn": false },
      "password": { "allowSignIn": true },
    }
  `);
});
