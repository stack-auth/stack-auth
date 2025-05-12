import { GET as latestHandler } from "@/app/api/latest/migration-tests/smart-route-handler/route";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { ensureObjectSchema, yupString } from "@stackframe/stack-shared/dist/schema-fields";

export const GET = createSmartRouteHandler({
  ...latestHandler.initArgs[0],
  request: ensureObjectSchema(latestHandler.initArgs[0].request).shape({
    query: ensureObjectSchema(latestHandler.initArgs[0].request.getNested("query")).shape({
      queryParamNew: yupString().defined(),
    }),
  }),
});
