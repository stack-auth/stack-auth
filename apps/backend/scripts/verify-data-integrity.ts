import { PrismaClient } from "@prisma/client";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { filterUndefined } from "@stackframe/stack-shared/dist/utils/objects";
import { wait } from "@stackframe/stack-shared/dist/utils/promises";
import { deindent } from "@stackframe/stack-shared/dist/utils/strings";

const prismaClient = new PrismaClient();

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

  const startAt = Math.max(0, +(process.argv[2] || "1") - 1);
  const flags = process.argv.slice(3);
  const skipUsers = flags.includes("--skip-users");

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

  for (let i = startAt; i < projects.length; i++) {
    const projectId = projects[i].id;
    await recurse(`[project ${i + 1}/${projects.length}] ${projectId} ${projects[i].displayName}`, async (recurse) => {
      const [currentProject, users] = await Promise.all([
        expectStatusCode(200, `/api/v1/internal/projects/current`, {
          method: "GET",
          headers: {
            "x-stack-project-id": projectId,
            "x-stack-access-type": "admin",
            "x-stack-development-override-key": getEnvVariable("STACK_SEED_INTERNAL_PROJECT_SUPER_SECRET_ADMIN_KEY"),
          },
        }),
        expectStatusCode(200, `/api/v1/users`, {
          method: "GET",
          headers: {
            "x-stack-project-id": projectId,
            "x-stack-access-type": "admin",
            "x-stack-development-override-key": getEnvVariable("STACK_SEED_INTERNAL_PROJECT_SUPER_SECRET_ADMIN_KEY"),
          },
        }),
        // this endpoint calls the legacy function, so it's a great way to check for config integrity
        // once the legacy getProject function is gone, we can remove this too
        expectStatusCode(200, `/api/v1/projects/${projectId}/.well-known/jwks.json`, {
          method: "GET",
        }),
      ]);
      if (users.pagination?.next_cursor) throwErr("Users are paginated? Please update the verify-data-integrity.ts script to handle this.");
      if (currentProject.user_count !== users.items.length) throwErr("User count mismatch.", {
        projectUserCount: currentProject.user_count,
        usersUserCount: users.items.length,
      });

      if (!skipUsers) {
        for (let j = 0; j < users.items.length; j++) {
          const user = users.items[j];
          await recurse(`[user ${j + 1}/${users.items.length}] ${user.display_name ?? user.primary_email}`, async (recurse) => {
            await expectStatusCode(200, `/api/v1/users/${user.id}`, {
              method: "GET",
              headers: {
                "x-stack-project-id": projectId,
                "x-stack-access-type": "admin",
                "x-stack-development-override-key": getEnvVariable("STACK_SEED_INTERNAL_PROJECT_SUPER_SECRET_ADMIN_KEY"),
              },
            });
          });
        }
      }
    });
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
  if (response.status !== expectedStatusCode) {
    throw new StackAssertionError(deindent`
      Expected status code ${expectedStatusCode} but got ${response.status} for ${endpoint}:

          ${await response.text()}
    `, { request, response });
  }
  const json = await response.json();
  return json;
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
