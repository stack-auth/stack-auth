import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { deindent } from "@stackframe/stack-shared/dist/utils/strings";

export const GET = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    query: yupObject({
      queryParamNew: yupString().optional(),
    }),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["text"]).defined(),
    body: yupString().defined(),
  }),
  handler: async (req) => {
    return {
      statusCode: 200,
      bodyType: "text",
      body: deindent`
        Welcome to the migration test route for SmartRouteHandler! This route only exists for demonstration purposes and has no practical functionality.

        ${req.query.queryParamNew ? `The query parameter you passed in is: ${req.query.queryParamNew}` : "Looks like you didn't pass in the query parameter. That's fine, read on below to see what this route does."}

        Here's what it does:

        - v1: This route does not yet exist; it shows a 404 error.
        - v2beta1: Takes an optional query parameter 'queryParam' and displays it. If not given, it defaults to the string "n/a".
        - v2beta2: The query parameter is now required.
        - v2beta3: The query parameter is now called 'queryParamNew'.
        - v2beta4: The query parameter is now optional again (this is not actually a breaking change, so in a real scenario we wouldn't need a new version).
      `,
    };
  },
});
