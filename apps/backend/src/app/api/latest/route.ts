import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, projectIdSchema, yupNumber, yupObject, yupString, yupTuple } from "@hexclave/shared/dist/schema-fields";
import { deindent, typedCapitalize } from "@hexclave/shared/dist/utils/strings";

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
      // We list all automatically parsed headers here so the OpenAPI documentation shows them.
      // The canonical `X-Hexclave-*` header names are documented as primary; the legacy
      // `X-Stack-*` aliases are accepted on every endpoint and listed here for compatibility.
      "X-Hexclave-Project-Id": yupTuple([projectIdSchema]).optional(),
      "X-Hexclave-Branch-Id": yupTuple([projectIdSchema]).optional(),
      "X-Hexclave-Access-Type": yupTuple([yupString().oneOf(["client", "server", "admin"])]).optional(),
      "X-Hexclave-Access-Token": yupTuple([yupString()]).optional(),
      "X-Hexclave-Refresh-Token": yupTuple([yupString()]).optional(),
      "X-Hexclave-Publishable-Client-Key": yupTuple([yupString()]).optional(),
      "X-Hexclave-Secret-Server-Key": yupTuple([yupString()]).optional(),
      "X-Hexclave-Super-Secret-Admin-Key": yupTuple([yupString()]).optional(),
      "X-Stack-Project-Id": yupTuple([projectIdSchema]).optional(),
      "X-Stack-Branch-Id": yupTuple([projectIdSchema]).optional(),
      "X-Stack-Access-Type": yupTuple([yupString().oneOf(["client", "server", "admin"])]).optional(),
      "X-Stack-Access-Token": yupTuple([yupString()]).optional(),
      "X-Stack-Refresh-Token": yupTuple([yupString()]).optional(),
      "X-Stack-Publishable-Client-Key": yupTuple([yupString()]).optional(),
      "X-Stack-Secret-Server-Key": yupTuple([yupString()]).optional(),
      "X-Stack-Super-Secret-Admin-Key": yupTuple([yupString()]).optional(),
    }),
    method: yupString().oneOf(["GET"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["text"]).defined(),
    body: yupString().defined().meta({ openapiField: { exampleValue: "Welcome to the Hexclave API endpoint! Please refer to the documentation at https://docs.hexclave.com/\n\nAuthentication: None" } }),
  }),
  handler: async (req) => {
    return {
      statusCode: 200,
      bodyType: "text",
      body: deindent`
        Welcome to the Hexclave API endpoint! Please refer to the documentation at https://docs.hexclave.com.

        Authentication: ${!req.auth ? "None" : typedCapitalize(req.auth.type) + "\n" + deindent`
        ${"  "}Project: ${req.auth.project.id}
        ${"  "}User: ${req.auth.user ? req.auth.user.primary_email ?? req.auth.user.id : "None"}
        `}
      `,
    };
  },
});
