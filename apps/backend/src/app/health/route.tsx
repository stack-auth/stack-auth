import { globalPrismaClient } from "@/prisma-client";
import { HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";

export async function GET(req: Request) {
  if (new URL(req.url).searchParams.get("db")) {
    // Reading a real model verifies that the configured read path is reachable and that the
    // database has at least the Project columns expected by this server revision. This is more
    // useful than SELECT 1, which would stay green across a missed schema migration.
    const project = await globalPrismaClient.project.findFirst({});

    if (!project) {
      throw new HexclaveAssertionError("No project found");
    }
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
