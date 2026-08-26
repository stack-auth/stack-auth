import { authenticateMcpOAuthUser } from "@/app/api/latest/internal/mcp/auth";
import { listManagedProjectIds } from "@/lib/projects";
import { globalPrismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { yupArray, yupNumber, yupObject, yupString, yupTuple } from "@hexclave/shared/dist/schema-fields";

export const GET = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({}).nullable().optional(),
    method: yupString().oneOf(["GET"]).defined(),
    headers: yupObject({
      "authorization": yupTuple([yupString()]).optional(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      projects: yupArray(yupObject({
        id: yupString().defined(),
        display_name: yupString().defined(),
      }).defined()).defined(),
    }).defined(),
  }),
  handler: async ({ headers }) => {
    const user = await authenticateMcpOAuthUser(headers.authorization?.[0]);
    const managedProjectIds = await listManagedProjectIds(user);
    const projects = await globalPrismaClient.project.findMany({
      where: { id: { in: managedProjectIds } },
      select: { id: true, displayName: true },
      orderBy: { createdAt: "asc" },
    });
    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        projects: projects.map((project) => ({ id: project.id, display_name: project.displayName })),
      },
    };
  },
});
