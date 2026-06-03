import { globalPrismaClient } from "@/prisma-client";
import { HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";
import { NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("db")) {
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
