import { Prisma } from "@/generated/prisma/client";
import { overrideEnvironmentConfigOverride } from "@/lib/config";
import {
  LOCAL_EMULATOR_ADMIN_USER_ID,
  LOCAL_EMULATOR_ONLY_ENDPOINT_MESSAGE,
  LOCAL_EMULATOR_OWNER_TEAM_ID,
  isLocalEmulatorOnboardingEnabledInConfig,
  isLocalEmulatorEnabled,
  readConfigFromFile,
  resolveEmulatorPath,
  writeShowOnboardingConfigToFile,
} from "@/lib/local-emulator";
import { DEFAULT_BRANCH_ID, getSoleTenancyFromProjectBranch } from "@/lib/tenancies";
import { getPrismaClientForTenancy, globalPrismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import {
  clientOrHigherAuthTypeSchema,
  projectOnboardingStatusSchema,
  projectOnboardingStatusValues,
  type ProjectOnboardingStatus,
  yupBoolean,
  yupNumber,
  yupObject,
  yupString,
} from "@stackframe/stack-shared/dist/schema-fields";
import { generateSecureRandomString } from "@stackframe/stack-shared/dist/utils/crypto";
import { StackAssertionError, StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { generateUuid } from "@stackframe/stack-shared/dist/utils/uuids";
import fs from "fs/promises";
import * as path from "path";

type LocalEmulatorProjectMappingRow = {
  projectId: string,
};

function isProjectOnboardingStatus(value: string): value is ProjectOnboardingStatus {
  return projectOnboardingStatusValues.some((status) => status === value);
}

async function assertLocalEmulatorOwnerTeamReadiness() {
  const internalTenancy = await getSoleTenancyFromProjectBranch("internal", DEFAULT_BRANCH_ID);
  const internalPrisma = await getPrismaClientForTenancy(internalTenancy);

  const ownerTeam = await internalPrisma.team.findUnique({
    where: {
      tenancyId_teamId: {
        tenancyId: internalTenancy.id,
        teamId: LOCAL_EMULATOR_OWNER_TEAM_ID,
      },
    },
    select: {
      teamId: true,
    },
  });
  if (!ownerTeam) {
    throw new StackAssertionError("Local emulator owner team is missing. Run the seed script before requesting local emulator project credentials.");
  }

  const ownerMembership = await internalPrisma.teamMember.findUnique({
    where: {
      tenancyId_projectUserId_teamId: {
        tenancyId: internalTenancy.id,
        projectUserId: LOCAL_EMULATOR_ADMIN_USER_ID,
        teamId: LOCAL_EMULATOR_OWNER_TEAM_ID,
      },
    },
    select: {
      projectUserId: true,
    },
  });
  if (!ownerMembership) {
    throw new StackAssertionError("Local emulator user is not a member of the local emulator owner team. Run the seed script before requesting local emulator project credentials.");
  }
}

async function getOrCreateLocalEmulatorProjectId(absoluteFilePath: string): Promise<{ projectId: string, created: boolean }> {
  const existingRows = await globalPrismaClient.$queryRaw<LocalEmulatorProjectMappingRow[]>(Prisma.sql`
    SELECT "projectId"
    FROM "LocalEmulatorProject"
    WHERE "absoluteFilePath" = ${absoluteFilePath}
    LIMIT 1
  `);
  const existingRow = existingRows.length > 0 ? existingRows[0] : undefined;
  const projectId = existingRow ? existingRow.projectId : generateUuid();

  await globalPrismaClient.project.upsert({
    where: {
      id: projectId,
    },
    update: {},
    create: {
      id: projectId,
      displayName: `Local Emulator: ${path.basename(absoluteFilePath) || "Project"}`,
      description: `Local emulator project for ${absoluteFilePath}`,
      isProductionMode: false,
      ownerTeamId: LOCAL_EMULATOR_OWNER_TEAM_ID,
    },
  });

  await globalPrismaClient.tenancy.upsert({
    where: {
      projectId_branchId_hasNoOrganization: {
        projectId,
        branchId: DEFAULT_BRANCH_ID,
        hasNoOrganization: "TRUE",
      },
    },
    update: {},
    create: {
      projectId,
      branchId: DEFAULT_BRANCH_ID,
      organizationId: null,
      hasNoOrganization: "TRUE",
    },
  });

  const created = existingRow === undefined;

  // Seed environment-level defaults BEFORE registering as a LocalEmulatorProject:
  // once registered, setEnvironmentConfigOverride refuses to write.
  //   - domains.allowLocalhost: fresh emulator projects allow localhost redirects
  //     so developers don't hit "Redirect URL not whitelisted" before configuring
  //     trustedDomains.
  //   - payments.testMode: emulator payments always go through stripe-mock.
  if (created) {
    await overrideEnvironmentConfigOverride({
      projectId,
      branchId: DEFAULT_BRANCH_ID,
      environmentConfigOverrideOverride: {
        "domains.allowLocalhost": true,
        "payments.testMode": true,
      },
    });
  }

  await globalPrismaClient.$executeRaw(Prisma.sql`
    INSERT INTO "LocalEmulatorProject" ("absoluteFilePath", "projectId", "createdAt", "updatedAt")
    VALUES (${absoluteFilePath}, ${projectId}, NOW(), NOW())
    ON CONFLICT ("absoluteFilePath")
    DO UPDATE SET
      "projectId" = EXCLUDED."projectId",
      "updatedAt" = NOW()
  `);

  return { projectId, created };
}

async function getOrCreateCredentials(projectId: string) {
  const existingKeySet = await globalPrismaClient.apiKeySet.findFirst({
    where: {
      projectId,
      manuallyRevokedAt: null,
      expiresAt: {
        gt: new Date(),
      },
      secretServerKey: {
        not: null,
      },
      superSecretAdminKey: {
        not: null,
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  const keySet = existingKeySet ?? await globalPrismaClient.apiKeySet.create({
    data: {
      id: generateUuid(),
      projectId,
      description: `Local emulator key set for ${projectId}`,
      expiresAt: new Date("2099-12-31T23:59:59Z"),
      publishableClientKey: `pck_${generateSecureRandomString()}`,
      secretServerKey: `ssk_${generateSecureRandomString()}`,
      superSecretAdminKey: `sak_${generateSecureRandomString()}`,
    },
  });

  if (!keySet.publishableClientKey || !keySet.secretServerKey || !keySet.superSecretAdminKey) {
    throw new StackAssertionError("Local emulator key set is missing required keys.", {
      projectId,
      keySetId: keySet.id,
    });
  }

  return {
    publishableClientKey: keySet.publishableClientKey,
    secretServerKey: keySet.secretServerKey,
    superSecretAdminKey: keySet.superSecretAdminKey,
  };
}

async function syncLocalEmulatorOnboardingStatus(projectId: string, showOnboarding: boolean): Promise<ProjectOnboardingStatus> {
  const onboardingStateColumnExistsRows = await globalPrismaClient.$queryRaw<Array<{ exists: boolean }>>(Prisma.sql`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'Project'
        AND column_name = 'onboardingState'
    ) AS "exists"
  `);
  const onboardingStateColumnExists = onboardingStateColumnExistsRows[0]?.exists === true;

  const rows = await globalPrismaClient.$queryRaw<Array<{ onboardingStatus: string }>>(Prisma.sql`
    SELECT "onboardingStatus"
    FROM "Project"
    WHERE "id" = ${projectId}
    LIMIT 1
  `);
  const row = rows.length > 0 ? rows[0] : undefined;
  if (!row) {
    throw new StackAssertionError("Local emulator project not found while syncing onboarding state.", { projectId });
  }
  if (!isProjectOnboardingStatus(row.onboardingStatus)) {
    throw new StackAssertionError("Project onboarding status in DB is invalid.", {
      projectId,
      onboardingStatus: row.onboardingStatus,
    });
  }
  const currentOnboardingStatus = row.onboardingStatus;

  if (!showOnboarding) {
    if (onboardingStateColumnExists) {
      await globalPrismaClient.$executeRaw(Prisma.sql`
        UPDATE "Project"
        SET "onboardingStatus" = 'completed',
            "onboardingState" = NULL
        WHERE "id" = ${projectId}
      `);
    } else {
      await globalPrismaClient.$executeRaw(Prisma.sql`
        UPDATE "Project"
        SET "onboardingStatus" = 'completed'
        WHERE "id" = ${projectId}
      `);
    }
    return "completed";
  }

  if (currentOnboardingStatus === "completed") {
    await globalPrismaClient.$executeRaw(Prisma.sql`
      UPDATE "Project"
      SET "onboardingStatus" = 'config_choice'
      WHERE "id" = ${projectId}
    `);
    return "config_choice";
  }

  return currentOnboardingStatus;
}

export const POST = createSmartRouteHandler({
  metadata: {
    hidden: true,
    summary: "Get local emulator project credentials by absolute path",
    description: "Creates (if needed) and returns local emulator project credentials for a given absolute file path",
    tags: ["Local Emulator"],
  },
  request: yupObject({
    auth: yupObject({
      type: clientOrHigherAuthTypeSchema.defined(),
      project: yupObject({
        id: yupString().oneOf(["internal"]).defined(),
      }).defined(),
    }).defined(),
    method: yupString().oneOf(["POST"]).defined(),
    body: yupObject({
      absolute_file_path: yupString().defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      project_id: yupString().defined(),
      publishable_client_key: yupString().defined(),
      secret_server_key: yupString().defined(),
      super_secret_admin_key: yupString().defined(),
      branch_config_override_string: yupString().defined(),
      onboarding_status: projectOnboardingStatusSchema.defined(),
      onboarding_outstanding: yupBoolean().defined(),
    }).defined(),
  }),
  handler: async (req) => {
    if (!isLocalEmulatorEnabled()) {
      throw new StatusError(StatusError.BadRequest, LOCAL_EMULATOR_ONLY_ENDPOINT_MESSAGE);
    }
    if (!path.isAbsolute(req.body.absolute_file_path)) {
      throw new StatusError(StatusError.BadRequest, "absolute_file_path must be an absolute path.");
    }

    const absoluteFilePath = path.resolve(req.body.absolute_file_path);
    const resolvedFilePath = resolveEmulatorPath(absoluteFilePath);

    // Validate file exists before creating a project
    let fileExists: boolean;
    try {
      await fs.access(resolvedFilePath);
      fileExists = true;
    } catch {
      fileExists = false;
    }
    if (!fileExists) {
      throw new StatusError(StatusError.BadRequest, `Config file not found: ${absoluteFilePath}`);
    }

    // If the file is empty, write the onboarding sentinel config.
    const fileContent = await fs.readFile(resolvedFilePath, "utf-8");
    if (fileContent.trim() === "") {
      await writeShowOnboardingConfigToFile(absoluteFilePath);
    }

    await assertLocalEmulatorOwnerTeamReadiness();

    const { projectId } = await getOrCreateLocalEmulatorProjectId(absoluteFilePath);
    const showOnboarding = await isLocalEmulatorOnboardingEnabledInConfig(absoluteFilePath);
    const onboardingStatus = await syncLocalEmulatorOnboardingStatus(projectId, showOnboarding);
    const credentials = await getOrCreateCredentials(projectId);
    const fileConfig = await readConfigFromFile(absoluteFilePath);

    return {
      statusCode: 200 as const,
      bodyType: "json" as const,
      body: {
        project_id: projectId,
        publishable_client_key: credentials.publishableClientKey,
        secret_server_key: credentials.secretServerKey,
        super_secret_admin_key: credentials.superSecretAdminKey,
        branch_config_override_string: JSON.stringify(fileConfig),
        onboarding_status: onboardingStatus,
        onboarding_outstanding: onboardingStatus !== "completed",
      },
    };
  },
});
