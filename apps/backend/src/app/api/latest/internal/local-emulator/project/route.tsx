import { Prisma } from "@/generated/prisma/client";
import {
  LOCAL_EMULATOR_ADMIN_USER_ID,
  LOCAL_EMULATOR_ONLY_ENDPOINT_MESSAGE,
  LOCAL_EMULATOR_OWNER_TEAM_ID,
  isLocalEmulatorEnabled,
  readConfigFromFile,
  resolveEmulatorPath,
  writeConfigToFile,
} from "@/lib/local-emulator";
import { DEFAULT_BRANCH_ID, getSoleTenancyFromProjectBranch } from "@/lib/tenancies";
import { getPrismaClientForTenancy, globalPrismaClient, retryTransaction } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { clientOrHigherAuthTypeSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { generateSecureRandomString } from "@stackframe/stack-shared/dist/utils/crypto";
import { StackAssertionError, StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { generateUuid } from "@stackframe/stack-shared/dist/utils/uuids";
import fs from "fs/promises";
import * as path from "path";

type LocalEmulatorProjectMappingRow = {
  projectId: string,
};

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

async function getOrCreateProjectAndCredentials(absoluteFilePath: string, isEmptyConfig: boolean) {
  return await retryTransaction(globalPrismaClient, async (tx) => {
    // Use a Postgres advisory lock keyed on the file path to serialize concurrent requests.
    // pg_advisory_xact_lock is released automatically when the transaction ends.
    const lockKey = absoluteFilePath.split("").reduce((hash, char) => {
      return ((hash << 5) - hash + char.charCodeAt(0)) | 0;
    }, 0);
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(${lockKey})`);

    const existingRows = await tx.$queryRaw<LocalEmulatorProjectMappingRow[]>(Prisma.sql`
      SELECT "projectId"
      FROM "LocalEmulatorProject"
      WHERE "absoluteFilePath" = ${absoluteFilePath}
      LIMIT 1
    `);

    let projectId: string;
    let isNewProject = false;
    if (existingRows[0]) {
      projectId = existingRows[0].projectId;
    } else {
      isNewProject = true;
      projectId = generateUuid();

      await tx.project.create({
        data: {
          id: projectId,
          displayName: `Local Emulator: ${path.basename(absoluteFilePath) || "Project"}`,
          description: `Local emulator project for ${absoluteFilePath}`,
          isProductionMode: false,
          ownerTeamId: LOCAL_EMULATOR_OWNER_TEAM_ID,
        },
      });

      await tx.tenancy.create({
        data: {
          projectId,
          branchId: DEFAULT_BRANCH_ID,
          organizationId: null,
          hasNoOrganization: "TRUE",
        },
      });

      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "LocalEmulatorProject" ("absoluteFilePath", "projectId", "createdAt", "updatedAt")
        VALUES (${absoluteFilePath}, ${projectId}, NOW(), NOW())
      `);
    }

    // Get or create credentials within the same lock to avoid duplicate key sets
    const existingKeySet = await tx.apiKeySet.findFirst({
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

    const keySet = existingKeySet ?? await tx.apiKeySet.create({
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

    // Show onboarding only for brand new projects with empty config.
    let onboardingStatus: string | null;
    if (isNewProject && isEmptyConfig) {
      onboardingStatus = "apps_selection";
      await tx.project.update({
        where: { id: projectId },
        data: { onboardingStatus },
      });
    } else {
      onboardingStatus = await tx.project.findUniqueOrThrow({
        where: { id: projectId },
        select: { onboardingStatus: true },
      }).then((p) => p.onboardingStatus);
    }

    return {
      projectId,
      onboardingStatus,
      publishableClientKey: keySet.publishableClientKey,
      secretServerKey: keySet.secretServerKey,
      superSecretAdminKey: keySet.superSecretAdminKey,
    };
  });
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
      onboarding_status: yupString().defined(),
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

    // If the file is empty, write a default config
    const fileContent = await fs.readFile(resolvedFilePath, "utf-8");
    if (fileContent.trim() === "") {
      await writeConfigToFile(absoluteFilePath, {});
    }

    await assertLocalEmulatorOwnerTeamReadiness();

    const fileConfig = await readConfigFromFile(absoluteFilePath);
    const isEmptyConfig = Object.keys(fileConfig).length === 0;
    if (isEmptyConfig) {
      await writeConfigToFile(absoluteFilePath, {});
    }

    const result = await getOrCreateProjectAndCredentials(absoluteFilePath, isEmptyConfig);

    return {
      statusCode: 200 as const,
      bodyType: "json" as const,
      body: {
        project_id: result.projectId,
        publishable_client_key: result.publishableClientKey,
        secret_server_key: result.secretServerKey,
        super_secret_admin_key: result.superSecretAdminKey,
        branch_config_override_string: JSON.stringify(fileConfig),
        onboarding_status: result.onboardingStatus ?? "",
      },
    };
  },
});
