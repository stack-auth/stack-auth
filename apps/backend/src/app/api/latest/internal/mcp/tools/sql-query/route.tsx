import { executeSqlQuery } from "@/lib/ai/tools/sql-query-executor";
import { listManagedProjectIds } from "@/lib/projects";
import { DEFAULT_BRANCH_ID } from "@/lib/tenancies";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@hexclave/shared";
import { adaptSchema, clientOrHigherAuthTypeSchema, jsonSchema, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";

export const POST = createSmartRouteHandler({
  metadata: {
    hidden: true,
    summary: "Execute an authenticated MCP SQL query",
    tags: ["Internal"],
  },
  request: yupObject({
    auth: yupObject({
      type: clientOrHigherAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
      user: adaptSchema,
      project: adaptSchema.defined(),
    }).defined(),
    body: yupObject({
      project_id: yupString().defined().nonEmpty(),
      query: yupString().defined().nonEmpty(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: jsonSchema,
  }),
  handler: async ({ auth, body }) => {
    if (auth.user == null) {
      throw new KnownErrors.UserAuthenticationRequired();
    }
    if (auth.project.id !== "internal") {
      throw new KnownErrors.ExpectedInternalProject();
    }

    const managedProjectIds = await listManagedProjectIds(auth.user);
    if (!managedProjectIds.includes(body.project_id)) {
      throw new StatusError(StatusError.Forbidden, "You do not have access to this project");
    }

    const result = await executeSqlQuery({
      branchId: DEFAULT_BRANCH_ID,
      projectId: body.project_id,
      query: body.query,
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: result,
    };
  },
});
