import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, yupArray, yupBoolean, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { getOrCreateFeaturebaseUser } from "@stackframe/stack-shared/dist/utils/featurebase";

const STACK_FEATUREBASE_API_KEY = getEnvVariable("STACK_FEATUREBASE_API_KEY");

// GET /api/latest/internal/feature-requests
export const GET = createSmartRouteHandler({
  metadata: {
    summary: "Get feature requests",
    description: "Fetch all feature requests with upvote status for the current user",
    tags: ["Internal"],
  },
  request: yupObject({
    auth: yupObject({
      type: adaptSchema,
      user: adaptSchema.defined(),
      project: yupObject({
        id: yupString().oneOf(["internal"]).defined(),
      }).defined(),
    }).defined(),
    query: yupObject({}),
    method: yupString().oneOf(["GET"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      posts: yupArray(yupObject({
        id: yupString().defined(),
        title: yupString().defined(),
        content: yupString().nullable(),
        upvotes: yupNumber().defined(),
        date: yupString().defined(),
        postStatus: yupObject({
          name: yupString().defined(),
          color: yupString().defined(),
        }).noUnknown(false).nullable(),
        userHasUpvoted: yupBoolean().defined(),
      }).noUnknown(false)).defined(),
    }).defined(),
  }),
  handler: async ({ auth }) => {
    // Get or create Featurebase user for consistent email handling
    const featurebaseUser = await getOrCreateFeaturebaseUser({
      id: auth.user.id,
      primaryEmail: auth.user.primary_email,
      displayName: auth.user.display_name,
      profileImageUrl: auth.user.profile_image_url,
    });

    // Fetch all posts with sorting
    const response = await fetch('https://do.featurebase.app/v2/posts?limit=50&sortBy=upvotes:desc', {
      method: 'GET',
      headers: {
        'X-API-Key': STACK_FEATUREBASE_API_KEY,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      throw new StackAssertionError(`Featurebase API error: ${data.error || 'Failed to fetch feature requests'}`, {
        details: {
          response: response,
          responseData: data,
        },
      });
    }

    const posts = data.results || [];

    // Filter out posts that have been merged into other posts or are completed
    const activePosts = posts.filter((post: any) =>
      !post.mergedToSubmissionId &&
      post.postStatus?.type !== 'completed'
    );

    // Check upvote status for each post for the current user using Featurebase email
    const postsWithUpvoteStatus = await Promise.all(
      activePosts.map(async (post: any) => {
        let userHasUpvoted = false;

        const upvoteResponse = await fetch(`https://do.featurebase.app/v2/posts/upvoters?submissionId=${post.id}`, {
          method: 'GET',
          headers: {
            'X-API-Key': STACK_FEATUREBASE_API_KEY,
          },
        });

        if (upvoteResponse.ok) {
          const upvoteData = await upvoteResponse.json();
          const upvoters = upvoteData.results || [];
          userHasUpvoted = upvoters.some((upvoter: any) =>
            upvoter.userId === featurebaseUser.userId
          );
        }

        return {
          id: post.id,
          title: post.title,
          content: post.content,
          upvotes: post.upvotes || 0,
          date: post.date,
          postStatus: post.postStatus,
          userHasUpvoted,
        };
      })
    );

    return {
      statusCode: 200,
      bodyType: "json" as const,
      body: { posts: postsWithUpvoteStatus },
    };
  },
});

// POST /api/latest/internal/feature-requests
export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Create feature request",
    description: "Create a new feature request",
    tags: ["Internal"],
  },
  request: yupObject({
    auth: yupObject({
      type: adaptSchema,
      user: adaptSchema.defined(),
      project: yupObject({
        id: yupString().oneOf(["internal"]).defined(),
      }).defined(),
    }).defined(),
    body: yupObject({
      title: yupString().defined(),
      content: yupString().optional(),
      category: yupString().optional(),
      tags: yupArray(yupString()).optional(),
      commentsAllowed: yupBoolean().optional(),
      customInputValues: yupObject().noUnknown(false).optional().nullable(),
    }).defined(),
    method: yupString().oneOf(["POST"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      success: yupBoolean().defined(),
      id: yupString().optional(),
    }).defined(),
  }),
  handler: async ({ auth, body }) => {
    // Get or create Featurebase user for consistent email handling
    const featurebaseUser = await getOrCreateFeaturebaseUser({
      id: auth.user.id,
      primaryEmail: auth.user.primary_email,
      displayName: auth.user.display_name,
      profileImageUrl: auth.user.profile_image_url,
    });

    const featurebaseRequestBody = {
      title: body.title,
      content: body.content || '',
      category: body.category || 'feature-requests',
      tags: body.tags || ['feature_request', 'dashboard'],
      commentsAllowed: body.commentsAllowed ?? true,
      email: featurebaseUser.email,
      authorName: auth.user.display_name || 'Stack Auth User',
      customInputValues: {
        // Using the actual field IDs from Featurebase
        "6872f858cc9682d29cf2e4c0": 'dashboard_companion', // source field
        "6872f88041fa77a4dd9dab29": featurebaseUser.userId, // userId field
        "6872f890143fc108288d8f5a": 'stack-auth', // projectId field
        ...body.customInputValues,
      }
    };

    const response = await fetch('https://do.featurebase.app/v2/posts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': STACK_FEATUREBASE_API_KEY,
      },
      body: JSON.stringify(featurebaseRequestBody),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new StackAssertionError(`Featurebase API error: ${data.error || 'Failed to create feature request'}`, { data });
    }

    return {
      statusCode: 200,
      bodyType: "json" as const,
      body: { success: true, id: data.id },
    };
  },
});
