import { usersCrudHandlers } from "@/app/api/latest/users/crud";
import { UsersCrud } from "@stackframe/stack-shared/dist/interface/crud/users";
import { KeyIntersect } from "@stackframe/stack-shared/dist/utils/types";
import { Tenancy } from "./tenancies";

export async function createOrUpgradeAnonymousUser(
  tenancy: Tenancy,
  currentUser: UsersCrud["Admin"]["Read"] | null,
  createOrUpdate: KeyIntersect<UsersCrud["Admin"]["Create"], UsersCrud["Admin"]["Update"]>,
  allowedErrorTypes: (new (...args: any) => any)[],
): Promise<UsersCrud["Admin"]["Read"]> {
  if (currentUser?.is_anonymous) {
    // Upgrade anonymous user
    return await usersCrudHandlers.adminUpdate({
      tenancy,
      user_id: currentUser.id,
      data: {
        ...createOrUpdate,
        is_anonymous: false,
      },
      allowedErrorTypes,
    });
  } else {
    // Create new user (normal flow)
    return await usersCrudHandlers.adminCreate({
      tenancy,
      data: createOrUpdate,
      allowedErrorTypes,
    });
  }
}
