import { GET as v2beta3Handler } from "@/app/api/migrations/v2beta3/migration-tests/smart-route-handler/route";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { ensureObjectSchema, yupString } from "@stackframe/stack-shared/dist/schema-fields";

export const GET = createSmartRouteHandler({
  ...v2beta3Handler.initArgs[0],
  request: ensureObjectSchema(v2beta3Handler.initArgs[0].request).shape({
    query: ensureObjectSchema(v2beta3Handler.initArgs[0].request.getNested("query")).shape({
      queryParam: yupString().optional().default("n/a"),
    }),
  }),
});


