import {
  getBranchConfigOverrideSource,
  recordConfigRepoSnapshot,
} from "@/lib/config";
import { prepareConfigRepoSnapshot, type GithubRepoRef } from "@/lib/config/repo-agent";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { runAsynchronouslyAndWaitUntil } from "@/utils/background-tasks";
import { adaptSchema, adminAuthTypeSchema, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { StatusError, captureError } from "@hexclave/shared/dist/utils/errors";

export const maxDuration = 800;

/**
 * Warms the Vercel Sandbox snapshot for the linked repo so the first dashboard
 * config write warm-boots instead of cold-cloning. Fire-and-forget: returns
 * immediately and prepares the snapshot in the background. Apply is still
 * self-sufficient (it prepares on demand if no snapshot exists), so this is
 * purely an optimization to call when a repo is linked.
 */
export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Prepare the GitHub config repo sandbox snapshot",
    description: "Clones + installs the linked repo into a Vercel Sandbox snapshot so later config writes warm-boot.",
    tags: ["Config"],
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema,
      tenancy: adaptSchema,
    }).defined(),
    body: yupObject({
      github_access_token: yupString().defined(),
    }).defined(),
    method: yupString().oneOf(["POST"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      status: yupString().oneOf(["started", "already-prepared", "not-linked"]).defined(),
    }).defined(),
  }),
  handler: async (req) => {
    const projectId = req.auth.tenancy.project.id;
    const branchId = req.auth.tenancy.branchId;

    const source = await getBranchConfigOverrideSource({ projectId, branchId });
    if (source.type !== "pushed-from-github") {
      return { statusCode: 200, bodyType: "json", body: { status: "not-linked" } };
    }
    if (source.latest_snapshot) {
      return { statusCode: 200, bodyType: "json", body: { status: "already-prepared" } };
    }

    const githubToken = req.body.github_access_token;
    const ref: GithubRepoRef = { owner: source.owner, repo: source.repo, branch: source.branch };

    runAsynchronouslyAndWaitUntil(async () => {
      try {
        const snapshot = await prepareConfigRepoSnapshot({ githubToken, ref });
        await recordConfigRepoSnapshot({ projectId, branchId, nowMs: Date.now(), snapshot });
      } catch (error) {
        captureError("config-github-snapshot-prepare", error);
      }
    });

    return { statusCode: 200, bodyType: "json", body: { status: "started" } };
  },
});
