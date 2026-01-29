import { DEFAULT_BRANCH_ID, getSoleTenancyFromProjectBranch } from "@/lib/tenancies";
import { getPrismaClientForTenancy, globalPrismaClient } from "@/prisma-client";
import type { OrganizationRenderedConfig } from "@stackframe/stack-shared/dist/config/schema";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { deepPlainEquals, omit } from "@stackframe/stack-shared/dist/utils/objects";
import { wait } from "@stackframe/stack-shared/dist/utils/promises";
import { deindent } from "@stackframe/stack-shared/dist/utils/strings";
import fs from "fs";

import { createApiHelpers, type OutputData } from "./api";
import { createPaymentsVerifier } from "./payments-verifier";
import { createRecurse } from "./recurse";
import { verifyStripePayoutIntegrity } from "./stripe-payout-integrity";

const prismaClient = globalPrismaClient;
const OUTPUT_FILE_PATH = "./verify-data-integrity-output.untracked.json";
const STRIPE_SECRET_KEY = getEnvVariable("STACK_STRIPE_SECRET_KEY", "");
const USE_MOCK_STRIPE_API = STRIPE_SECRET_KEY === "sk_test_mockstripekey";

let targetOutputData: OutputData | undefined = undefined;
const currentOutputData: OutputData = {};

async function main() {
  console.log();
  console.log();
  console.log();
  console.log();
  console.log();
  console.log();
  console.log();
  console.log();
  console.log("===================================================");
  console.log("Welcome to verify-data-integrity.ts.");
  console.log();
  console.log("This script will ensure that the data in the");
  console.log("database is not corrupted.");
  console.log();
  console.log("It will call the most important endpoints for");
  console.log("each project and every user, and ensure that");
  console.log("the status codes are what they should be.");
  console.log();
  console.log("It's a good idea to run this script on REPLICAS");
  console.log("of the production database regularly (not the actual");
  console.log("prod db!); it should never fail at any point in time.");
  console.log();
  console.log("");
  console.log("\x1b[41mIMPORTANT\x1b[0m: This script may modify");
  console.log("the database during its execution in all sorts of");
  console.log("ways, so don't run it on production!");
  console.log();
  console.log("===================================================");
  console.log();
  console.log();
  console.log();
  console.log();
  console.log();
  console.log();
  console.log();
  console.log();
  console.log("Starting in 3 seconds...");
  await wait(1000);
  console.log("2...");
  await wait(1000);
  console.log("1...");
  await wait(1000);
  console.log();
  console.log();
  console.log();
  console.log();

  const numericArgs = process.argv.filter(arg => arg.match(/^[0-9]+$/)).map(arg => +arg);
  const startAt = Math.max(0, (numericArgs[0] ?? 1) - 1);
  const count = numericArgs[1] ?? Infinity;
  const flags = process.argv.slice(1);
  const skipUsers = flags.includes("--skip-users");
  const shouldSaveOutput = flags.includes("--save-output");
  const shouldVerifyOutput = flags.includes("--verify-output");
  const shouldSkipNeon = flags.includes("--skip-neon");
  const recentFirst = flags.includes("--recent-first");
  const noBail = flags.includes("--no-bail");

  const { recurse, collectedErrors } = createRecurse({ noBail });

  if (noBail) {
    console.log(`Running in no-bail mode: will continue on errors and report all at the end.`);
  }

  if (shouldSaveOutput) {
    console.log(`Will save output to ${OUTPUT_FILE_PATH}`);
  }
  if (shouldSkipNeon) {
    console.log(`Will skip Neon projects.`);
  }

  if (shouldVerifyOutput) {
    if (!fs.existsSync(OUTPUT_FILE_PATH)) {
      throw new Error(`Cannot verify output: ${OUTPUT_FILE_PATH} does not exist`);
    }
    try {
      targetOutputData = JSON.parse(fs.readFileSync(OUTPUT_FILE_PATH, "utf8"));

      // TODO next-release these are hacks for the migration, delete them
      if (targetOutputData) {
        targetOutputData["/api/v1/internal/projects/current"] = targetOutputData["/api/v1/internal/projects/current"].map(output => {
          if ("config" in output.responseJson) {
            delete output.responseJson.config.id;
            output.responseJson.config.oauth_providers = output.responseJson.config.oauth_providers
              // `any` because this is historical output JSON from disk.
              // We intentionally keep this "migration hack" untyped.
              .filter((provider: any) => provider.enabled)
              .map((provider: any) => omit(provider, ["enabled"]));
          }
          return output;
        });
      }

      console.log(`Loaded previous output data for verification`);
    } catch (error) {
      throw new Error(`Failed to parse output file: ${error}`);
    }
  }

  const { expectStatusCode } = createApiHelpers({
    currentOutputData,
    targetOutputData,
  });

  const projects = await prismaClient.project.findMany({
    select: {
      id: true,
      displayName: true,
      description: true,
      stripeAccountId: true,
    },
    orderBy: recentFirst ? {
      updatedAt: "desc",
    } : {
      id: "asc",
    },
  });
  console.log(`Found ${projects.length} projects, iterating over them.`);
  if (startAt !== 0) {
    console.log(`Starting at project ${startAt}.`);
  }
  if (USE_MOCK_STRIPE_API) {
    console.warn("Using mock Stripe server (STACK_STRIPE_SECRET_KEY=sk_test_mockstripekey); skipping Stripe payout integrity checks.");
  }

  const maxUsersPerProject = 100;

  const endAt = Math.min(startAt + count, projects.length);
  for (let i = startAt; i < endAt; i++) {
    const projectId = projects[i].id;
    await recurse(`[project ${(i + 1) - startAt}/${endAt - startAt}] ${projectId} ${projects[i].displayName}`, async (recurse) => {
      if (shouldSkipNeon && projects[i].description.includes("Neon")) {
        return;
      }

      const [currentProject, users, projectPermissionDefinitions, teamPermissionDefinitions] = await Promise.all([
        expectStatusCode(200, `/api/v1/internal/projects/current`, {
          method: "GET",
          headers: {
            "x-stack-project-id": projectId,
            "x-stack-access-type": "admin",
            "x-stack-development-override-key": getEnvVariable("STACK_SEED_INTERNAL_PROJECT_SUPER_SECRET_ADMIN_KEY"),
          },
        }),
        expectStatusCode(200, `/api/v1/users?limit=${maxUsersPerProject}`, {
          method: "GET",
          headers: {
            "x-stack-project-id": projectId,
            "x-stack-access-type": "admin",
            "x-stack-development-override-key": getEnvVariable("STACK_SEED_INTERNAL_PROJECT_SUPER_SECRET_ADMIN_KEY"),
          },
        }),
        expectStatusCode(200, `/api/v1/project-permission-definitions`, {
          method: "GET",
          headers: {
            "x-stack-project-id": projectId,
            "x-stack-access-type": "admin",
            "x-stack-development-override-key": getEnvVariable("STACK_SEED_INTERNAL_PROJECT_SUPER_SECRET_ADMIN_KEY"),
          },
        }),
        expectStatusCode(200, `/api/v1/team-permission-definitions`, {
          method: "GET",
          headers: {
            "x-stack-project-id": projectId,
            "x-stack-access-type": "admin",
            "x-stack-development-override-key": getEnvVariable("STACK_SEED_INTERNAL_PROJECT_SUPER_SECRET_ADMIN_KEY"),
          },
        }),
      ]);
      void currentProject;

      const tenancy = await getSoleTenancyFromProjectBranch(projectId, DEFAULT_BRANCH_ID, true);
      const paymentsConfig = tenancy ? (tenancy.config as OrganizationRenderedConfig).payments : undefined;
      const paymentsVerifier = tenancy && paymentsConfig
        ? await createPaymentsVerifier({
          projectId,
          tenancyId: tenancy.id,
          tenancy,
          paymentsConfig,
          prisma: await getPrismaClientForTenancy(tenancy),
          expectStatusCode,
        })
        : null;

      const stripeAccountId = projects[i].stripeAccountId;
      if (!USE_MOCK_STRIPE_API && tenancy && stripeAccountId != null) {
        await verifyStripePayoutIntegrity({
          projectId,
          tenancy,
          stripeAccountId,
          expectStatusCode,
        });
      }

      const verifiedTeams = new Set<string>();

      if (!skipUsers) {
        for (let j = 0; j < users.items.length; j++) {
          const user = users.items[j];
          await recurse(`[user ${j + 1}/${users.items.length}] ${user.display_name ?? user.primary_email}`, async (recurse) => {
            // get user individually
            await expectStatusCode(200, `/api/v1/users/${user.id}`, {
              method: "GET",
              headers: {
                "x-stack-project-id": projectId,
                "x-stack-access-type": "admin",
                "x-stack-development-override-key": getEnvVariable("STACK_SEED_INTERNAL_PROJECT_SUPER_SECRET_ADMIN_KEY"),
              },
            });

            // list project permissions
            const projectPermissions = await expectStatusCode(200, `/api/v1/project-permissions?user_id=${user.id}`, {
              method: "GET",
              headers: {
                "x-stack-project-id": projectId,
                "x-stack-access-type": "admin",
                "x-stack-development-override-key": getEnvVariable("STACK_SEED_INTERNAL_PROJECT_SUPER_SECRET_ADMIN_KEY"),
              },
            });
            for (const projectPermission of projectPermissions.items) {
              // `any` because these endpoint response types aren't imported here,
              // and this script is intentionally tolerant of response shape changes.
              if (!projectPermissionDefinitions.items.some((p: any) => p.id === projectPermission.id)) {
                throw new StackAssertionError(deindent`
                  Project permission ${projectPermission.id} not found in project permission definitions.
                `);
              }
            }

            // list teams
            const teams = await expectStatusCode(200, `/api/v1/teams?user_id=${user.id}`, {
              method: "GET",
              headers: {
                "x-stack-project-id": projectId,
                "x-stack-access-type": "admin",
                "x-stack-development-override-key": getEnvVariable("STACK_SEED_INTERNAL_PROJECT_SUPER_SECRET_ADMIN_KEY"),
              },
            });

            for (const team of teams.items) {
              await recurse(`[team ${team.id}] ${team.name}`, async (recurse) => {
                // list team permissions
                const teamPermissions = await expectStatusCode(200, `/api/v1/team-permissions?team_id=${team.id}`, {
                  method: "GET",
                  headers: {
                    "x-stack-project-id": projectId,
                    "x-stack-access-type": "admin",
                    "x-stack-development-override-key": getEnvVariable("STACK_SEED_INTERNAL_PROJECT_SUPER_SECRET_ADMIN_KEY"),
                  },
                });
                for (const teamPermission of teamPermissions.items) {
                  // `any` because these endpoint response types aren't imported here,
                  // and this script is intentionally tolerant of response shape changes.
                  if (!teamPermissionDefinitions.items.some((p: any) => p.id === teamPermission.id)) {
                    throw new StackAssertionError(deindent`
                      Team permission ${teamPermission.id} not found in team permission definitions.
                    `);
                  }
                }
              });

              if (paymentsVerifier && !verifiedTeams.has(team.id)) {
                await paymentsVerifier.verifyCustomerPayments({
                  customerType: "team",
                  customerId: team.id,
                });
                verifiedTeams.add(team.id);
              }
            }

            if (paymentsVerifier) {
              await paymentsVerifier.verifyCustomerPayments({
                customerType: "user",
                customerId: user.id,
              });
            }
          });
        }

        if (paymentsVerifier) {
          for (const customCustomerId of paymentsVerifier.customCustomerIds) {
            await paymentsVerifier.verifyCustomerPayments({
              customerType: "custom",
              customerId: customCustomerId,
            });
          }
        }
      }
    });
  }

  if (targetOutputData && !deepPlainEquals(currentOutputData, targetOutputData)) {
    throw new StackAssertionError(deindent`
      Output data mismatch between final and target output data.
    `);
  }
  if (shouldSaveOutput) {
    fs.writeFileSync(OUTPUT_FILE_PATH, JSON.stringify(currentOutputData, null, 2));
    console.log(`Output saved to ${OUTPUT_FILE_PATH}`);
  }

  // Report collected errors if in no-bail mode
  if (collectedErrors.length > 0) {
    console.log();
    console.log();
    console.log();
    console.log();
    console.log("===================================================");
    console.log(`\x1b[41mFAILED\x1b[0m! Found ${collectedErrors.length} error(s):`);
    console.log();
    for (let i = 0; i < collectedErrors.length; i++) {
      const { context, error } = collectedErrors[i];
      console.log(`--- Error ${i + 1}/${collectedErrors.length} ---`);
      console.log(`Context: ${context}`);
      console.error(error);
      console.log();
    }
    console.log("===================================================");
    console.log();
    process.exit(1);
  }

  console.log();
  console.log();
  console.log();
  console.log();
  console.log();
  console.log();
  console.log();
  console.log();
  console.log("===================================================");
  console.log("All good!");
  console.log();
  console.log("Goodbye.");
  console.log("===================================================");
  console.log();
  console.log();
}

// eslint-disable-next-line no-restricted-syntax
main().catch((...args) => {
  console.error();
  console.error();
  console.error(`\x1b[41mERROR\x1b[0m! Could not verify data integrity. See the error message for more details.`);
  console.error(...args);
  process.exit(1);
});

