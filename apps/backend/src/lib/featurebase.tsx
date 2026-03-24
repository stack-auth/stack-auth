import { UsersCrud } from "@stackframe/stack-shared/dist/interface/crud/users";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { getOrCreateFeaturebaseUser as getOrCreateFeaturebaseUserShared, StackAuthUser } from "@stackframe/stack-shared/dist/utils/featurebase";

export function getFeaturebaseApiKey(): string {
  return getEnvVariable("STACK_FEATUREBASE_API_KEY", "");
}

export function requireFeaturebaseApiKey(): string {
  const key = getFeaturebaseApiKey();
  if (!key) {
    throw new StackAssertionError("STACK_FEATUREBASE_API_KEY environment variable is not set");
  }
  return key;
}

export function toFeaturebaseUserArgs(user: UsersCrud["Admin"]["Read"]): StackAuthUser {
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
