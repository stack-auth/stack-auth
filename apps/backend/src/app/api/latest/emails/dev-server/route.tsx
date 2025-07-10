import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { FreestyleSandboxes } from 'freestyle-sandboxes';

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Create email theme dev server",
    description: "Creates a new dev server for email theme development",
    tags: ["Emails"],
  },
  request: yupObject({
    auth: yupObject({
      type: yupString().oneOf(["admin"]).defined(),
    }).nullable(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      repo_id: yupString().defined(),
      preview_url: yupString().defined(),
    }).defined(),
  }),
  async handler() {
    console.log("Creating email theme dev server");
    const apiKey = getEnvVariable("STACK_FREESTYLE_API_KEY");
    if (!apiKey) {
      throw new StatusError(500, "STACK_FREESTYLE_API_KEY is not set");
    }

    if (apiKey === "mock_stack_freestyle_key") {
      return {
        statusCode: 200,
        bodyType: "json",
        body: {
          repo_id: "mock-repo-id",
          preview_url: "https://mock-preview.com",
        },
      };
    }

    console.log("FreestyleSandboxes");
    const freestyle = new FreestyleSandboxes({ apiKey });
    console.log("FreestyleSandboxes created");
    const { repoId } = await freestyle.createGitRepository({
      public: true,
      source: {
        url: "https://github.com/BilalG1/email-preview.git",
        type: "git",
      }
    });
    console.log("Git repository created");

    const devServer = await freestyle.requestDevServer({ repoId });
    console.log("Dev server requested");
    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        repo_id: repoId,
        preview_url: devServer.ephemeralUrl,
      },
    };
  },
});

export const GET = createSmartRouteHandler({
  metadata: {
    summary: "Request email theme dev server",
    description: "Requests a dev server for an existing email theme repository",
    tags: ["Emails"],
  },
  request: yupObject({
    auth: yupObject({
      type: yupString().oneOf(["admin"]).defined(),
    }).nullable(),
    query: yupObject({
      repo_id: yupString().defined(),
    }),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      preview_url: yupString().defined(),
    }).defined(),
  }),
  async handler({ query }) {
    const apiKey = getEnvVariable("STACK_FREESTYLE_API_KEY");
    if (!apiKey) {
      throw new StatusError(500, "STACK_FREESTYLE_API_KEY is not set");
    }

    if (apiKey === "mock_stack_freestyle_key") {
      return {
        statusCode: 200,
        bodyType: "json",
        body: {
          preview_url: "https://mock-preview.com",
        },
      };
    }

    const freestyle = new FreestyleSandboxes({ apiKey });
    const devServer = await freestyle.requestDevServer({ repoId: query.repo_id });
    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        preview_url: devServer.ephemeralUrl,
      },
    };
  },
});
