import { createAuthTokens } from "@/lib/tokens";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { usersCrudHandlers } from "../../../users/crud";

// Define the allowed project IDs for anonymous sign-up
const ALLOWED_PROJECT_IDS = [
  "9bee8100-8d83-4ad7-aaad-d6607e386a28",
  "71bd203a-14d9-4ccc-b704-32bfac0e2542",
  "internal",
];

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Sign up anonymously",
    description: "Create a new anonymous account with no email",
    tags: ["Anonymous"],
  },
  request: yupObject({
    auth: yupObject({
      type: clientOrHigherAuthTypeSchema,
      project: adaptSchema,
      tenancy: adaptSchema,
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      access_token: yupString().defined(),
      refresh_token: yupString().defined(),
      user_id: yupString().defined(),
    }).defined(),
  }),
  async handler({ auth: { project, type, tenancy } }) {
    if (!ALLOWED_PROJECT_IDS.includes(project.id)) {
      throw new KnownErrors.AnonymousAccountsNotEnabled();
    }

    const createdUser = await usersCrudHandlers.adminCreate({
      tenancy,
      data: {
        display_name: "Anonymous user",
        is_anonymous: true,
      },
      allowedErrorTypes: [],
    });

    const { refreshToken, accessToken } = await createAuthTokens({
      tenancy,
      projectUserId: createdUser.id,
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        access_token: accessToken,
        refresh_token: refreshToken,
        user_id: createdUser.id,
      },
    };
  },
});
