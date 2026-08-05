import { globalPrismaClient } from "@/prisma-client";

export async function GET(req: Request) {
  return await getHealthResponse(req, checkDatabaseConnection);
}

async function checkDatabaseConnection(): Promise<void> {
  await globalPrismaClient.$primary().project.findFirst({
    select: { id: true },
  });
}

async function getHealthResponse(req: Request, checkDatabase: () => Promise<unknown>) {
  if (new URL(req.url).searchParams.get("db")) {
    // A readiness probe needs database connectivity, not application data. An
    // empty but correctly migrated database is ready and should pass this check.
    await checkDatabase();
  }

  return Response.json({
    status: "ok",
  }, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "*",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Expose-Headers": "*",
    }
  });
}

const vitest = import.meta.vitest;
vitest?.test("the database readiness probe verifies connectivity without requiring rows", async ({ expect }) => {
  const { vi } = vitest;
  const checkDatabase = vi.fn(async () => {});
  const livenessResponse = await getHealthResponse(new Request("http://localhost/health"), checkDatabase);
  const readinessResponse = await getHealthResponse(new Request("http://localhost/health?db=1"), checkDatabase);

  expect({
    livenessStatus: livenessResponse.status,
    readinessStatus: readinessResponse.status,
    databaseChecks: checkDatabase.mock.calls.length,
  }).toEqual({
    livenessStatus: 200,
    readinessStatus: 200,
    databaseChecks: 1,
  });
  await expect(getHealthResponse(
    new Request("http://localhost/health?db=1"),
    async () => {
      throw new Error("database unavailable");
    },
  )).rejects.toThrowErrorMatchingInlineSnapshot(`[Error: database unavailable]`);
});
