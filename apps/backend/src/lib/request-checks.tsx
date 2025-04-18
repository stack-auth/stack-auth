import { ProxiedOAuthProviderType, StandardOAuthProviderType } from "@prisma/client";
import { KnownErrors } from "@stackframe/stack-shared";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { ProviderType, sharedProviders, standardProviders } from "@stackframe/stack-shared/dist/utils/oauth";
import { typedToUppercase } from "@stackframe/stack-shared/dist/utils/strings";
import { listPermissions } from "./permissions";
import { Tenancy } from "./tenancies";
import { PrismaTransaction } from "./types";


async function _getTeamMembership(
  tx: PrismaTransaction,
  options: {
    tenancyId: string,
    teamId: string, userId: string,
  }
) {
  return await tx.teamMember.findUnique({
    where: {
      tenancyId_projectUserId_teamId: {
        tenancyId: options.tenancyId,
        projectUserId: options.userId,
        teamId: options.teamId,
      },
    },
  });
}

export async function ensureTeamMembershipExists(
  tx: PrismaTransaction,
  options: {
    tenancyId: string,
    teamId: string,
    userId: string,
  }
) {
  await ensureUserExists(tx, { tenancyId: options.tenancyId, userId: options.userId });

  const member = await _getTeamMembership(tx, options);

  if (!member) {
    throw new KnownErrors.TeamMembershipNotFound(options.teamId, options.userId);
  }
}

export async function ensureTeamMembershipDoesNotExist(
  tx: PrismaTransaction,
  options: {
    tenancyId: string,
    teamId: string,
    userId: string,
  }
) {
  const member = await _getTeamMembership(tx, options);

  if (member) {
    throw new KnownErrors.TeamMembershipAlreadyExists();
  }
}

export async function ensureTeamExists(
  tx: PrismaTransaction,
  options: {
    tenancyId: string,
    teamId: string,
  }
) {
  const team = await tx.team.findUnique({
    where: {
      tenancyId_teamId: {
        tenancyId: options.tenancyId,
        teamId: options.teamId,
      },
    },
  });

  if (!team) {
    throw new KnownErrors.TeamNotFound(options.teamId);
  }
}

export async function ensureUserTeamPermissionExists(
  tx: PrismaTransaction,
  options: {
    tenancy: Tenancy,
    teamId: string,
    userId: string,
    permissionId: string,
    errorType: 'required' | 'not-exist',
    recursive: boolean,
  }
) {
  await ensureTeamMembershipExists(tx, {
    tenancyId: options.tenancy.id,
    teamId: options.teamId,
    userId: options.userId,
  });

  const result = await listPermissions(tx, {
    scope: 'team',
    tenancy: options.tenancy,
    teamId: options.teamId,
    userId: options.userId,
    permissionId: options.permissionId,
    recursive: options.recursive,
  });

  if (result.length === 0) {
    if (options.errorType === 'not-exist') {
      throw new KnownErrors.TeamPermissionNotFound(options.teamId, options.userId, options.permissionId);
    } else {
      throw new KnownErrors.TeamPermissionRequired(options.teamId, options.userId, options.permissionId);
    }
  }
}

export async function ensureProjectPermissionExists(
  tx: PrismaTransaction,
  options: {
    tenancy: Tenancy,
    userId: string,
    permissionId: string,
    errorType: 'required' | 'not-exist',
    recursive: boolean,
  }
) {
  await ensureUserExists(tx, {
    tenancyId: options.tenancy.id,
    userId: options.userId,
  });

  const result = await listPermissions(tx, {
    scope: 'project',
    tenancy: options.tenancy,
    userId: options.userId,
    permissionId: options.permissionId,
    recursive: options.recursive,
  });

  if (result.length === 0) {
    if (options.errorType === 'not-exist') {
      throw new KnownErrors.PermissionNotFound(options.permissionId);
    } else {
      throw new KnownErrors.ProjectPermissionRequired(options.userId, options.permissionId);
    }
  }
}

export async function ensureUserExists(
  tx: PrismaTransaction,
  options: {
    tenancyId: string,
    userId: string,
  }
) {
  const user = await tx.projectUser.findUnique({
    where: {
      tenancyId_projectUserId: {
        tenancyId: options.tenancyId,
        projectUserId: options.userId,
      },
    },
  });

  if (!user) {
    throw new KnownErrors.UserNotFound();
  }
}

export function ensureSharedProvider(
  providerId: ProviderType
): Lowercase<ProxiedOAuthProviderType> {
  if (!sharedProviders.includes(providerId as any)) {
    throw new KnownErrors.InvalidSharedOAuthProviderId(providerId);
  }
  return providerId as any;
}

export function ensureStandardProvider(
  providerId: ProviderType
): Lowercase<StandardOAuthProviderType> {
  if (!standardProviders.includes(providerId as any)) {
    throw new KnownErrors.InvalidStandardOAuthProviderId(providerId);
  }
  return providerId as any;
}

export async function ensureContactChannelDoesNotExists(
  tx: PrismaTransaction,
  options: {
    tenancyId: string,
    userId: string,
    type: 'email',
    value: string,
  }
) {
  const contactChannel = await tx.contactChannel.findUnique({
    where: {
      tenancyId_projectUserId_type_value: {
        tenancyId: options.tenancyId,
        projectUserId: options.userId,
        type: typedToUppercase(options.type),
        value: options.value,
      },
    },
  });

  if (contactChannel) {
    throw new StatusError(StatusError.BadRequest, 'Contact channel already exists');
  }
}

export async function ensureContactChannelExists(
  tx: PrismaTransaction,
  options: {
    tenancyId: string,
    userId: string,
    contactChannelId: string,
  }
) {
  const contactChannel = await tx.contactChannel.findUnique({
    where: {
      tenancyId_projectUserId_id: {
        tenancyId: options.tenancyId,
        projectUserId: options.userId,
        id: options.contactChannelId,
      },
    },
  });

  if (!contactChannel) {
    throw new StatusError(StatusError.BadRequest, 'Contact channel not found');
  }

  return contactChannel;
}
