import { PrismaClient } from "@prisma/client";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { deepPlainEquals, filterUndefined, omit } from "@stackframe/stack-shared/dist/utils/objects";
import { wait } from "@stackframe/stack-shared/dist/utils/promises";
import { deindent } from "@stackframe/stack-shared/dist/utils/strings";
import fs from "fs";

const prismaClient = new PrismaClient();
const OUTPUT_FILE_PATH = "./verify-data-integrity-output.untracked.json";

type EndpointOutput = {
  status: number,
  responseJson: any,
};

type OutputData = Record<string, EndpointOutput[]>;

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


  if (shouldSaveOutput) {
    console.log(`Will save output to ${OUTPUT_FILE_PATH}`);
  }

  if (shouldVerifyOutput) {
    if (!fs.existsSync(OUTPUT_FILE_PATH)) {
      throw new Error(`Cannot verify output: ${OUTPUT_FILE_PATH} does not exist`);
    }
    try {
      targetOutputData = JSON.parse(fs.readFileSync(OUTPUT_FILE_PATH, 'utf8'));

      // TODO next-release these are hacks for the migration, delete them
      if (targetOutputData) {
        targetOutputData["/api/v1/internal/projects/current"] = targetOutputData["/api/v1/internal/projects/current"].map(output => {
          if ("config" in output.responseJson) {
            delete output.responseJson.config.id;
            output.responseJson.config.oauth_providers = output.responseJson.config.oauth_providers
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

  const projects = await prismaClient.project.findMany({
    select: {
      id: true,
      displayName: true,
    },
    orderBy: {
      id: "asc",
    },
  });
  console.log(`Found ${projects.length} projects, iterating over them.`);
  if (startAt !== 0) {
    console.log(`Starting at project ${startAt}.`);
  }

  const maxUsersPerProject = 10000;

  const endAt = Math.min(startAt + count, projects.length);
  for (let i = startAt; i < endAt; i++) {
    const projectId = projects[i].id;
    await recurse(`[project ${(i + 1) - startAt}/${endAt - startAt}] ${projectId} ${projects[i].displayName}`, async (recurse) => {
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
                  if (!teamPermissionDefinitions.items.some((p: any) => p.id === teamPermission.id)) {
                    throw new StackAssertionError(deindent`
                      Team permission ${teamPermission.id} not found in team permission definitions.
                    `);
                  }
                }
              });
            }
          });
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
main().catch((...args) => {
  console.error();
  console.error();
  console.error(`\x1b[41mERROR\x1b[0m! Could not verify data integrity. See the error message for more details.`);
  console.error(...args);
  process.exit(1);
});

async function expectStatusCode(expectedStatusCode: number, endpoint: string, request: RequestInit) {
  const apiUrl = new URL(getEnvVariable("NEXT_PUBLIC_STACK_API_URL"));
  const response = await fetch(new URL(endpoint, apiUrl), {
    ...request,
    headers: {
      "x-stack-disable-artificial-development-delay": "yes",
      "x-stack-development-disable-extended-logging": "yes",
      ...filterUndefined(request.headers ?? {}),
    },
  });

  const responseText = await response.text();

  if (response.status !== expectedStatusCode) {
    throw new StackAssertionError(deindent`
      Expected status code ${expectedStatusCode} but got ${response.status} for ${endpoint}:

          ${responseText}
    `, { request, response });
  }

  const responseJson = JSON.parse(responseText);
  const currentOutput: EndpointOutput = {
    status: response.status,
    responseJson,
  };

  appendOutputData(endpoint, currentOutput);

  return responseJson;
}

function appendOutputData(endpoint: string, output: EndpointOutput) {
  if (!(endpoint in currentOutputData)) {
    currentOutputData[endpoint] = [];
  }
  const newLength = currentOutputData[endpoint].push(output);
  if (targetOutputData) {
    if (!(endpoint in targetOutputData)) {
      throw new StackAssertionError(deindent`
        Output data mismatch for endpoint ${endpoint}:
          Expected ${endpoint} to be in targetOutputData, but it is not.
      `, { endpoint });
    }
    if (targetOutputData[endpoint].length < newLength) {
      throw new StackAssertionError(deindent`
        Output data mismatch for endpoint ${endpoint}:
          Expected ${targetOutputData[endpoint].length} outputs but got at least ${newLength}.
      `, { endpoint });
    }
    if (!(deepPlainEquals(targetOutputData[endpoint][newLength - 1], output))) {
      throw new StackAssertionError(deindent`
        Output data mismatch for endpoint ${endpoint}:
          Expected output[${JSON.stringify(endpoint)}][${newLength - 1}] to be:
            ${JSON.stringify(targetOutputData[endpoint][newLength - 1], null, 2)}
          but got:
            ${JSON.stringify(output, null, 2)}.
      `, { endpoint });
    }
  }
}

let lastProgress = performance.now() - 9999999999;

type RecurseFunction = (progressPrefix: string, inner: (recurse: RecurseFunction) => Promise<void>) => Promise<void>;

const _recurse = async (progressPrefix: string | ((...args: any[]) => void), inner: Parameters<RecurseFunction>[1]): Promise<void> => {
  const progressFunc = typeof progressPrefix === "function" ? progressPrefix : (...args: any[]) => {
    console.log(`${progressPrefix}`, ...args);
  };
  if (performance.now() - lastProgress > 1000) {
    progressFunc();
    lastProgress = performance.now();
  }
  try {
    return await inner(
      (progressPrefix, inner) => _recurse(
        (...args) => progressFunc(progressPrefix, ...args),
        inner,
      ),
    );
  } catch (error) {
    progressFunc(`\x1b[41mERROR\x1b[0m!`);
    throw error;
  }
};
const recurse: RecurseFunction = _recurse;
