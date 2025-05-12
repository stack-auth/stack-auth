import { GET as v2beta4Handler } from "@/app/api/migrations/v2beta4/migration-tests/smart-route-handler/route";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { ensureObjectSchema, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { omit } from "@stackframe/stack-shared/dist/utils/objects";

export const GET = createSmartRouteHandler({
  ...v2beta4Handler.initArgs[0],
  request: ensureObjectSchema(v2beta4Handler.initArgs[0].request).shape({
    query: ensureObjectSchema(v2beta4Handler.initArgs[0].request.getNested("query")).omit(["queryParamNew"]).shape({
      queryParam: yupString().defined(),
    }),
  }),
  handler: async (req, fullReq) => {
    return await v2beta4Handler.invoke({
      ...fullReq,
      query: {
        ...omit(fullReq.query, ["queryParam"]),
        queryParamNew: req.query.queryParam,
      },
    });
  },
});

