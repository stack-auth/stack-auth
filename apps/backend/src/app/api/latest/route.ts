import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, projectIdSchema, yupNumber, yupObject, yupString, yupTuple } from "@stackframe/stack-shared/dist/schema-fields";
import { deindent, typedCapitalize } from "@stackframe/stack-shared/dist/utils/strings";

export const GET = createSmartRouteHandler({
  metadata: {
    summary: "/api/v1",
    description: "Returns a human-readable message with some useful information about the API.",
    tags: [],
  },
  request: yupObject({
    auth: yupObject({
      type: adaptSchema,
      user: adaptSchema,
      project: adaptSchema,
    }).nullable(),
    query: yupObject({
      // No query parameters
      // empty object means that it will fail if query parameters are given regardless
    }),
    headers: yupObject({
      // we list all automatically parsed headers here so the documentation shows them
      "X-Stack-Project-Id": yupTuple([projectIdSchema]),
      "X-Stack-Branch-Id": yupTuple([projectIdSchema]).optional(),
      "X-Stack-Access-Type": yupTuple([yupString().oneOf(["client", "server", "admin"])]),
      "X-Stack-Access-Token": yupTuple([yupString()]),
      "X-Stack-Refresh-Token": yupTuple([yupString()]),
      "X-Stack-Publishable-Client-Key": yupTuple([yupString()]),
      "X-Stack-Secret-Server-Key": yupTuple([yupString()]),
      "X-Stack-Super-Secret-Admin-Key": yupTuple([yupString()]),
    }),
    method: yupString().oneOf(["GET"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["text"]).defined(),
    body: yupString().defined().meta({ openapiField: { exampleValue: "Welcome to the Stack API endpoint! Please refer to the documentation at https://docs.stack-auth.com/\n\nAuthentication: None" } }),
  }),
  handler: async (req) => {
    return {
      statusCode: 200,
      bodyType: "text",
      body: deindent`
        Welcome to the Stack API endpoint! Please refer to the documentation at https://docs.stack-auth.com.

        Authentication: ${!req.auth ? "None" : typedCapitalize(req.auth.type) + "\n" + deindent`
        ${"  "}Project: ${req.auth.project.id}
        ${"  "}User: ${req.auth.user ? req.auth.user.primary_email ?? req.auth.user.id : "None"}
        `}
      `,
    };
  },
});
