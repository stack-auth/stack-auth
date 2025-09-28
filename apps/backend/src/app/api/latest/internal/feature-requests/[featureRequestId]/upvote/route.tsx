import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, yupBoolean, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { getOrCreateFeaturebaseUser } from "@stackframe/stack-shared/dist/utils/featurebase";

const STACK_FEATUREBASE_API_KEY = getEnvVariable("STACK_FEATUREBASE_API_KEY");

// POST /api/latest/internal/feature-requests/[featureRequestId]/upvote
export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Toggle upvote on feature request",
    description: "Toggle upvote on a feature request for the current user",
    tags: ["Internal"],
  },
  request: yupObject({
    auth: yupObject({
      type: adaptSchema,
      user: adaptSchema.defined(),
      project: yupObject({
        id: yupString().oneOf(["internal"]).defined(),
      })
    }).defined(),
    params: yupObject({
      featureRequestId: yupString().defined(),
    }).defined(),
    body: yupObject({}),
    method: yupString().oneOf(["POST"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      success: yupBoolean().defined(),
      upvoted: yupBoolean().optional(),
    }).defined(),
  }),
  handler: async ({ auth, params }) => {
    // Get or create Featurebase user for consistent email handling
    const featurebaseUser = await getOrCreateFeaturebaseUser({
      id: auth.user.id,
      primaryEmail: auth.user.primary_email,
      displayName: auth.user.display_name,
      profileImageUrl: auth.user.profile_image_url,
    });

    const response = await fetch('https://do.featurebase.app/v2/posts/upvoters', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': STACK_FEATUREBASE_API_KEY,
      },
      body: JSON.stringify({
        id: params.featureRequestId,
        email: featurebaseUser.email,
      }),
    });

    let data;
    try {
      data = await response.json();
    } catch (error) {
      if (error instanceof StackAssertionError) {
        throw error;
      }
      throw new StackAssertionError("Failed to parse Featurebase upvote response", { cause: error });
    }

    if (!response.ok) {
      throw new StackAssertionError(`Featurebase upvote API error: ${data.error || 'Failed to toggle upvote'}`, { data });
    }

    return {
      statusCode: 200,
      bodyType: "json" as const,
      body: { success: true, upvoted: data.upvoted },
    };
  },
});
