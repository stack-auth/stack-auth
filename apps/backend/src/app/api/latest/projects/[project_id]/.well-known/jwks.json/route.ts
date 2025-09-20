import { yupArray, yupNumber, yupObject, yupString, yupTuple } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { deindent } from "@stackframe/stack-shared/dist/utils/strings";
import { getProject } from "../../../../../../../lib/projects";
import { getPublicProjectJwkSet } from "../../../../../../../lib/tokens";
import { createSmartRouteHandler } from "../../../../../../../route-handlers/smart-route-handler";

export const GET = createSmartRouteHandler({
  metadata: {
    summary: "JWKS Endpoint",
    description: deindent`
      Returns a JSON Web Key Set (JWKS) for the given project, allowing you to verify JWTs for the given project without hitting our API. If include_anonymous is true, it will also include the JWKS for the anonymous users of the project.
    `,
    tags: [],
  },
  request: yupObject({
    params: yupObject({
      project_id: yupString().defined(),
    }),
    query: yupObject({
      include_anonymous: yupString().oneOf(["true", "false"]).default("false"),
    }),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      keys: yupArray().defined(),
    }).defined(),
    headers: yupObject({
      "Cache-Control": yupTuple([yupString().defined()]).defined(),
    }).defined(),
  }),
  async handler({ params, query }) {
    const project = await getProject(params.project_id);

    if (!project) {
      throw new StatusError(404, "Project not found");
    }

    return {
      statusCode: 200,
      bodyType: "json",
      body: await getPublicProjectJwkSet(params.project_id, query.include_anonymous === "true"),
      headers: {
        // Cache for 1 hour
        "Cache-Control": ["public, max-age=3600"] as const,
      },
    };
  },
});
