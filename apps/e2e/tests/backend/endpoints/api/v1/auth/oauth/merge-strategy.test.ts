import { it } from "../../../../../../helpers";
import { ApiKey, Auth, ContactChannels, Project } from "../../../../../backend-helpers";

it("should allow duplicates, if the merge strategy is set to allow_duplicates", async ({ expect }) => {
  const proj = await Project.createAndSwitch({
    config: {
      magic_link_enabled: true,
      oauth_account_merge_strategy: "allow_duplicates",
      oauth_providers: [{
        id: "spotify",
        enabled: true,
        type: "shared",
      }],
    }
  });
  await ApiKey.createAndSetProjectKeys(proj.adminAccessToken);

  await Auth.Otp.signIn();
  const cc = await ContactChannels.getTheOnlyContactChannel();
  expect(cc.is_verified).toBe(true);
  expect(cc.used_for_auth).toBe(true);

  await Auth.OAuth.signIn();
  const cc2 = await ContactChannels.getTheOnlyContactChannel();
  expect(cc2.value).toBe(cc.value);
  expect(cc2.is_verified).toBe(true);
  expect(cc2.used_for_auth).toBe(false);

  expect(cc.id).not.toBe(cc2.id);
});

it("should not allow duplicates, if the merge strategy set to raise_error", async ({ expect }) => {
  const proj = await Project.createAndSwitch({
    config: {
      magic_link_enabled: true,
      oauth_account_merge_strategy: "raise_error",
      oauth_providers: [{
        id: "spotify",
        enabled: true,
        type: "shared",
      }],
    }
  });
  await ApiKey.createAndSetProjectKeys(proj.adminAccessToken);

  await Auth.Otp.signIn();
  const cc = await ContactChannels.getTheOnlyContactChannel();
  expect(cc.is_verified).toBe(true);
  expect(cc.used_for_auth).toBe(true);

  await expect(Auth.OAuth.signIn()).rejects.toThrowError();
});

it("should merge accounts, if the merge strategy set to link_method", async ({ expect }) => {
  const proj = await Project.createAndSwitch({
    config: {
      magic_link_enabled: true,
      oauth_account_merge_strategy: "link_method",
      oauth_providers: [{
        id: "spotify",
        enabled: true,
        type: "shared",
      }],
    }
  });
  await ApiKey.createAndSetProjectKeys(proj.adminAccessToken);

  await Auth.Otp.signIn();
  const cc = await ContactChannels.getTheOnlyContactChannel();
  expect(cc.is_verified).toBe(true);
  expect(cc.used_for_auth).toBe(true);

  await Auth.OAuth.signIn();
  const cc2 = await ContactChannels.getTheOnlyContactChannel();
  expect(cc2.value).toBe(cc.value);
  expect(cc2.is_verified).toBe(true);
  expect(cc2.used_for_auth).toBe(true);

  expect(cc.id).toBe(cc2.id);
});
