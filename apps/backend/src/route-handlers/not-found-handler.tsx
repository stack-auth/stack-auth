import { yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { deindent } from "@hexclave/shared/dist/utils/strings";
import { createSmartRouteHandler } from "./smart-route-handler";

export const NotFoundHandler = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    url: yupString().defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([404]).defined(),
    bodyType: yupString().oneOf(["text"]).defined(),
    body: yupString().defined(),
  }),
  handler: async (req, fullReq) => {
    return {
      statusCode: 404,
      bodyType: "text",
      body: deindent`
        404 — this page does not exist in Hexclave's API.
        
        Please see the API documentation at https://docs.hexclave.com, or visit the Hexclave dashboard at https://app.hexclave.com.

        URL: ${req.url}
      `,
    };
  },
});
