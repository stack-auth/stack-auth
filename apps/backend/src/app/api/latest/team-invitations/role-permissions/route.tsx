import { listPermissionDefinitions } from "@/lib/permissions";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupArray, yupBoolean, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";

export const GET = createSmartRouteHandler({
  metadata: {
    summary: "Get role-based permissions for team invitations",
    description: "Fetch available role-based permissions that can be assigned to team members during invitations. Only returns role-based permissions, not system permissions.",
    tags: ["Teams"],
  },
  request: yupObject({
    auth: yupObject({
      type: clientOrHigherAuthTypeSchema,
      tenancy: adaptSchema.defined(),
      user: adaptSchema.optional(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      items: yupArray(yupObject({
        id: yupString().defined(),
        description: yupString().optional(),
        contained_permission_ids: yupArray(yupString().defined()).defined(),
      }).defined()).defined(),
      is_paginated: yupBoolean().oneOf([false]).defined(),
    }).defined(),
  }),
  async handler({ auth }) {
    const allPermissions = await listPermissionDefinitions({
      scope: "team",
      tenancy: auth.tenancy,
    });

    // Return all permissions including system permissions (starting with $)
    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        items: allPermissions,
        is_paginated: false,
      },
    };
  },
});
