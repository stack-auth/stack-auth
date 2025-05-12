import { yupArray, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { getPerAudienceSecret, getPublicJwkSet } from "@stackframe/stack-shared/dist/utils/jwt";
import { getProject } from "../../../../../../../lib/projects";
import { createSmartRouteHandler } from "../../../../../../../route-handlers/smart-route-handler";

export const GET = createSmartRouteHandler({
  metadata: {
    summary: "JWKS Endpoint",
    description: "Returns information about the JSON Web Key Set (JWKS) used to sign and verify JWTs.",
    tags: [],
    hidden: true,
  },
  request: yupObject({
    params: yupObject({
      project_id: yupString().defined(),
    }),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      keys: yupArray().defined(),
    }).defined(),
  }),
  async handler({ params }) {
    const project = await getProject(params.project_id);

    if (!project) {
      throw new StatusError(404, "Project not found");
    }

    return {
      statusCode: 200,
      bodyType: "json",
      body: await getPublicJwkSet(getPerAudienceSecret({
        audience: params.project_id,
        secret: getEnvVariable("STACK_SERVER_SECRET"),
      })),
    };
  },
});
