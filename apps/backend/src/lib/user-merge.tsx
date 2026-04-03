import { BooleanTrue } from "@/generated/prisma/client";
import { recordExternalDbSyncContactChannelDeletionsForUser, recordExternalDbSyncDeletion } from "@/lib/external-db-sync";
import { PrismaClientTransaction } from "@/prisma-client";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { Tenancy } from "./tenancies";

/**
 * Merges an anonymous user's data (team memberships, permissions, metadata, etc.)
 * into an authenticated user, then deletes the anonymous user.
 *
 * This is used when a CLI session starts with an anonymous user and the browser
 * completes authentication with a different (real) user. The anonymous user's
 * relationships are transferred to the authenticated user before deletion.
 */
export async function mergeAnonymousUserIntoAuthenticatedUser(
  tx: PrismaClientTransaction,
  options: {
    tenancy: Tenancy,
    anonymousUserId: string,
    authenticatedUserId: string,
  },
) {
  if (options.anonymousUserId === options.authenticatedUserId) {
    return;
  }

  const [anonymousUser, authenticatedUser] = await Promise.all([
    tx.projectUser.findUnique({
      where: {
        tenancyId_projectUserId: {
          tenancyId: options.tenancy.id,
          projectUserId: options.anonymousUserId,
        },
      },
      select: {
        projectUserId: true,
        isAnonymous: true,
        clientMetadata: true,
        clientReadOnlyMetadata: true,
        serverMetadata: true,
        profileImageUrl: true,
        signUpCountryCode: true,
      },
    }),
    tx.projectUser.findUnique({
      where: {
        tenancyId_projectUserId: {
          tenancyId: options.tenancy.id,
          projectUserId: options.authenticatedUserId,
        },
      },
      select: {
        projectUserId: true,
        clientMetadata: true,
        clientReadOnlyMetadata: true,
        serverMetadata: true,
        profileImageUrl: true,
        signUpCountryCode: true,
      },
    }),
  ]);

  if (!anonymousUser) {
    return;
  }

  if (!authenticatedUser) {
    throw new StackAssertionError("Authenticated user disappeared while completing CLI auth", options);
  }

  if (!anonymousUser.isAnonymous) {
    // User was upgraded concurrently; treat as already authenticated, skip merge
    return;
  }

  const [anonymousContactChannelCount, anonymousAuthMethodCount, anonymousOauthAccountCount] = await Promise.all([
    tx.contactChannel.count({
      where: {
        tenancyId: options.tenancy.id,
        projectUserId: options.anonymousUserId,
      },
    }),
    tx.authMethod.count({
      where: {
        tenancyId: options.tenancy.id,
        projectUserId: options.anonymousUserId,
      },
    }),
    tx.projectUserOAuthAccount.count({
      where: {
        tenancyId: options.tenancy.id,
        projectUserId: options.anonymousUserId,
      },
    }),
  ]);

  if (anonymousContactChannelCount > 0 || anonymousAuthMethodCount > 0 || anonymousOauthAccountCount > 0) {
    throw new StackAssertionError("Anonymous CLI user unexpectedly has account identity records that cannot be safely merged", {
      ...options,
      anonymousContactChannelCount,
      anonymousAuthMethodCount,
      anonymousOauthAccountCount,
    });
  }

  let authenticatedHasSelectedTeam = (
    await tx.teamMember.findFirst({
      where: {
        tenancyId: options.tenancy.id,
        projectUserId: options.authenticatedUserId,
        isSelected: BooleanTrue.TRUE,
      },
      select: {
        teamId: true,
      },
    })
  ) !== null;

  const authenticatedTeamIds = new Set((await tx.teamMember.findMany({
    where: {
      tenancyId: options.tenancy.id,
      projectUserId: options.authenticatedUserId,
    },
    select: {
      teamId: true,
    },
  })).map((membership) => membership.teamId));

  const anonymousTeamMemberships = await tx.teamMember.findMany({
    where: {
      tenancyId: options.tenancy.id,
      projectUserId: options.anonymousUserId,
    },
    include: {
      teamMemberDirectPermissions: true,
    },
  });

  for (const membership of anonymousTeamMemberships) {
    const shouldSelectTargetMembership = membership.isSelected === BooleanTrue.TRUE && !authenticatedHasSelectedTeam;

    if (authenticatedTeamIds.has(membership.teamId)) {
      if (shouldSelectTargetMembership) {
        await tx.teamMember.update({
          where: {
            tenancyId_projectUserId_teamId: {
              tenancyId: options.tenancy.id,
              projectUserId: options.authenticatedUserId,
              teamId: membership.teamId,
            },
          },
          data: {
            isSelected: BooleanTrue.TRUE,
          },
        });
        authenticatedHasSelectedTeam = true;
      }

      const authenticatedPermissionIds = new Set((await tx.teamMemberDirectPermission.findMany({
        where: {
          tenancyId: options.tenancy.id,
          projectUserId: options.authenticatedUserId,
          teamId: membership.teamId,
        },
        select: {
          permissionId: true,
        },
      })).map((permission) => permission.permissionId));

      for (const permission of membership.teamMemberDirectPermissions) {
        if (authenticatedPermissionIds.has(permission.permissionId)) {
          await tx.teamMemberDirectPermission.delete({
            where: {
              id: permission.id,
            },
          });
        } else {
          await tx.teamMemberDirectPermission.update({
            where: {
              id: permission.id,
            },
            data: {
              projectUserId: options.authenticatedUserId,
            },
          });
        }
      }

      await tx.teamMember.delete({
        where: {
          tenancyId_projectUserId_teamId: {
            tenancyId: options.tenancy.id,
            projectUserId: options.anonymousUserId,
            teamId: membership.teamId,
          },
        },
      });

      continue;
    }

    await tx.teamMember.update({
      where: {
        tenancyId_projectUserId_teamId: {
          tenancyId: options.tenancy.id,
          projectUserId: options.anonymousUserId,
          teamId: membership.teamId,
        },
      },
      data: {
        projectUserId: options.authenticatedUserId,
        isSelected: shouldSelectTargetMembership ? BooleanTrue.TRUE : null,
      },
    });

    authenticatedTeamIds.add(membership.teamId);
    if (shouldSelectTargetMembership) {
      authenticatedHasSelectedTeam = true;
    }
  }

  const authenticatedProjectPermissionIds = new Set((await tx.projectUserDirectPermission.findMany({
    where: {
      tenancyId: options.tenancy.id,
      projectUserId: options.authenticatedUserId,
    },
    select: {
      permissionId: true,
    },
  })).map((permission) => permission.permissionId));

  const anonymousProjectPermissions = await tx.projectUserDirectPermission.findMany({
    where: {
      tenancyId: options.tenancy.id,
      projectUserId: options.anonymousUserId,
    },
  });

  for (const permission of anonymousProjectPermissions) {
    if (authenticatedProjectPermissionIds.has(permission.permissionId)) {
      await tx.projectUserDirectPermission.delete({
        where: {
          id: permission.id,
        },
      });
    } else {
      await tx.projectUserDirectPermission.update({
        where: {
          id: permission.id,
        },
        data: {
          projectUserId: options.authenticatedUserId,
        },
      });
    }
  }

  const authenticatedNotificationCategoryIds = new Set((await tx.userNotificationPreference.findMany({
    where: {
      tenancyId: options.tenancy.id,
      projectUserId: options.authenticatedUserId,
    },
    select: {
      notificationCategoryId: true,
    },
  })).map((preference) => preference.notificationCategoryId));

  const anonymousNotificationPreferences = await tx.userNotificationPreference.findMany({
    where: {
      tenancyId: options.tenancy.id,
      projectUserId: options.anonymousUserId,
    },
  });

  for (const preference of anonymousNotificationPreferences) {
    if (authenticatedNotificationCategoryIds.has(preference.notificationCategoryId)) {
      await tx.userNotificationPreference.delete({
        where: {
          tenancyId_id: {
            tenancyId: options.tenancy.id,
            id: preference.id,
          },
        },
      });
    } else {
      await tx.userNotificationPreference.update({
        where: {
          tenancyId_id: {
            tenancyId: options.tenancy.id,
            id: preference.id,
          },
        },
        data: {
          projectUserId: options.authenticatedUserId,
        },
      });
    }
  }

  await Promise.all([
    tx.projectApiKey.updateMany({
      where: {
        tenancyId: options.tenancy.id,
        projectUserId: options.anonymousUserId,
      },
      data: {
        projectUserId: options.authenticatedUserId,
      },
    }),
    tx.sessionReplay.updateMany({
      where: {
        tenancyId: options.tenancy.id,
        projectUserId: options.anonymousUserId,
      },
      data: {
        projectUserId: options.authenticatedUserId,
      },
    }),
    tx.projectUser.update({
      where: {
        tenancyId_projectUserId: {
          tenancyId: options.tenancy.id,
          projectUserId: options.authenticatedUserId,
        },
      },
      data: {
        clientMetadata: authenticatedUser.clientMetadata ?? anonymousUser.clientMetadata ?? undefined,
        clientReadOnlyMetadata: authenticatedUser.clientReadOnlyMetadata ?? anonymousUser.clientReadOnlyMetadata ?? undefined,
        serverMetadata: authenticatedUser.serverMetadata ?? anonymousUser.serverMetadata ?? undefined,
        profileImageUrl: authenticatedUser.profileImageUrl ?? anonymousUser.profileImageUrl ?? undefined,
        signUpCountryCode: authenticatedUser.signUpCountryCode ?? anonymousUser.signUpCountryCode ?? undefined,
      },
    }),
    tx.projectUserAuthorizationCode.deleteMany({
      where: {
        tenancyId: options.tenancy.id,
        projectUserId: options.anonymousUserId,
      },
    }),
    tx.projectUserRefreshToken.deleteMany({
      where: {
        tenancyId: options.tenancy.id,
        projectUserId: options.anonymousUserId,
      },
    }),
  ]);

  await recordExternalDbSyncDeletion(tx, {
    tableName: "ProjectUser",
    tenancyId: options.tenancy.id,
    projectUserId: options.anonymousUserId,
  });

  await recordExternalDbSyncContactChannelDeletionsForUser(tx, {
    tenancyId: options.tenancy.id,
    projectUserId: options.anonymousUserId,
  });

  await tx.projectUser.delete({
    where: {
      tenancyId_projectUserId: {
        tenancyId: options.tenancy.id,
        projectUserId: options.anonymousUserId,
      },
    },
  });
}
