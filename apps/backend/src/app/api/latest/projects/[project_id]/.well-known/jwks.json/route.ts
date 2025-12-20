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
      Returns a JSON Web Key Set (JWKS) for the given project, allowing you to verify JWTs for the given project without hitting our API. If include_restricted is true, it will also include the JWKS for restricted users. If include_anonymous is true, it will also include the JWKS for anonymous users (and restricted users).
    `,
    tags: [],
  },
  request: yupObject({
    params: yupObject({
      project_id: yupString().defined(),
    }),
    query: yupObject({
      include_restricted: yupString().oneOf(["true", "false"]).default("false"),
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

    const allowAnonymous = query.include_anonymous === "true";
    // include_anonymous also includes restricted (since anonymous users are "less authenticated" than restricted users)
    const allowRestricted = allowAnonymous || query.include_restricted === "true";

    return {
      statusCode: 200,
      bodyType: "json",
      body: await getPublicProjectJwkSet(params.project_id, { allowRestricted, allowAnonymous }),
      headers: {
        // Cache for 1 hour
        "Cache-Control": ["public, max-age=3600"] as const,
      },
    };
  },
});
