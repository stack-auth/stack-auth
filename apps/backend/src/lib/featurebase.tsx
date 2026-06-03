import { UsersCrud } from "@hexclave/shared/dist/interface/crud/users";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";
import { getOrCreateFeaturebaseUser as getOrCreateFeaturebaseUserShared, HexclaveAuthUser } from "@hexclave/shared/dist/utils/featurebase";

export function getFeaturebaseApiKey(): string {
  return getEnvVariable("STACK_FEATUREBASE_API_KEY", "");
}

export function requireFeaturebaseApiKey(): string {
  const key = getFeaturebaseApiKey();
  if (!key) {
    throw new HexclaveAssertionError("STACK_FEATUREBASE_API_KEY environment variable is not set");
  }
  return key;
}

export function toFeaturebaseUserArgs(user: UsersCrud["Admin"]["Read"]): HexclaveAuthUser {
  return {
    id: user.id,
    primaryEmail: user.primary_email,
    displayName: user.display_name,
    profileImageUrl: user.profile_image_url,
  };
}

export async function getOrCreateFeaturebaseUserFromAuth(user: UsersCrud["Admin"]["Read"]) {
  return await getOrCreateFeaturebaseUserShared(toFeaturebaseUserArgs(user));
}
