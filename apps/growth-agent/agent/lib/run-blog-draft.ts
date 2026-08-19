import type { SendFn } from "eve/channels";
import { buildGrowthSessionAuth } from "#lib/run-context.ts";
import { PLAIN_LANGUAGE_RULE } from "#lib/writing-style.ts";

/**
 * On-demand generation of one blog post for a `publish_blog` action item, dispatched synchronously
 * from the `/blog-draft` channel route (the backend awaits the finished post and stores it).
 *
 * WHY THIS IS NOT PART OF A RUN: writing a full post inline made the SEO & AEO analysis topic the
 * slowest phase of every run by ~4x, and since analysis phases run in parallel the slowest one sets
 * the run's wall clock. The run now produces only the idea; the post is written here, once a human
 * has actually chosen it. See lib/growth/blog-drafts.ts on the backend for the full rationale.
 *
 * DESIGN — no tools, no token: everything this session reasons from is passed inline by the backend
 * (the idea plus the product context). That keeps it a single fast model turn, and means no run
 * token is minted and no agent-write surface is involved; the backend stores the returned markdown
 * itself. `agent_token` is deliberately absent from the request shape for the same reason.
 */

/** Inbound body of POST /blog-draft (backend -> agent). */
export type BlogDraftRequest = {
  readonly project_id: string,
  readonly branch_id: string,
  readonly action_item_id: string,
  readonly action_title: string,
  readonly action_description: string,
  readonly blog_idea: {
    readonly title: string,
    readonly target_intent: string | null,
    readonly aeo_angle: string | null,
    readonly outline_summary: string | null,
  },
  readonly product: {
    readonly website_url: string | null,
    readonly company_summary: string | null,
  },
};

export type BlogDraftResult = {
  readonly draft_markdown: string,
};

/**
 * Upper bound on one generation. Below the backend's own Eve timeout so a stuck session surfaces as
 * this module's error (which the route maps to a 500) rather than as an opaque client-side abort.
 */
const MAX_BLOG_DRAFT_MS = 3 * 60 * 1000;

function buildBlogDraftPrompt(input: BlogDraftRequest): string {
  const idea = input.blog_idea;
  return [
    `Write one complete, publishable blog post for the product at ${input.product.website_url ?? "(website not recorded)"}.`,
    "",
    input.product.company_summary != null ? `What the product does: ${input.product.company_summary}` : "The product summary was not recorded; infer what you can from the idea below and stay generic where you cannot.",
    "",
    "The growth analysis proposed this piece:",
    `- Working title: ${idea.title}`,
    idea.target_intent != null ? `- Target search intent / keyword cluster: ${idea.target_intent}` : "- Target search intent: not specified",
    idea.aeo_angle != null ? `- AEO angle (the direct question an assistant should be able to cite this post for): ${idea.aeo_angle}` : "- AEO angle: not specified",
    idea.outline_summary != null ? `- What it must cover: ${idea.outline_summary}` : "- Coverage notes: not specified",
    `- Why the team picked it: ${input.action_description}`,
    "",
    "Rules:",
    "- Output ONLY the post, as markdown, starting with a single `# ` title. No preamble, no commentary, no code fences around the whole document.",
    "- Open by answering the target question directly in the first two sentences — that is what makes the post citable by answer engines.",
    "- Be specific to THIS product. Never invent statistics, customer quotes, funding, awards, or named customers; if you need a number you were not given, write around it instead.",
    "- Write the complete post with no placeholder sections, no 'TODO', and no bracketed instructions to the author.",
    // Only the plain-language half of the house style applies here: a blog post is meant to be
    // long-form, so the brevity targets in WRITING_STYLE_RULES would fight the purpose of the piece.
    `- ${PLAIN_LANGUAGE_RULE}`,
    "- Length follows the topic, not a word count. Every paragraph must add something; cut any section that only restates another one.",
    "- Do not call any tools. Produce the post in your reply.",
  ].join("\n");
}

/** Runs the generation session and returns its final text as the post. */
export async function executeBlogDraft(input: BlogDraftRequest, helpers: { readonly send: SendFn }): Promise<BlogDraftResult> {
  const session = await helpers.send(buildBlogDraftPrompt(input), {
    auth: buildGrowthSessionAuth({
      project_id: input.project_id,
      branch_id: input.branch_id,
      // No run/phase context and no agent_token: this session calls no backend routes at all, so it
      // holds no capability. "report" is the honest finding_source bucket if a tool ever were added.
      finding_source: "report",
    }),
    // One session per action item: a repeat request for the same item is a retry of the same work,
    // and the backend only calls this at all when no draft exists yet.
    continuationToken: `blog-draft:${input.action_item_id}`,
    mode: "task",
    title: `Growth blog draft (${input.blog_idea.title})`,
  });

  const chunks: string[] = [];
  const stream = await session.getEventStream({ startIndex: 0 });
  const reader = stream.getReader();
  let timeoutTimer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<"timeout">((resolve) => {
    timeoutTimer = setTimeout(() => resolve("timeout"), MAX_BLOG_DRAFT_MS);
    timeoutTimer.unref();
  });
  try {
    collect: while (true) {
      const readResult = await Promise.race([reader.read(), timeoutPromise]);
      if (readResult === "timeout") {
        await reader.cancel();
        throw new Error(`Blog draft generation timed out: session=${session.id}`);
      }
      const { done, value: event } = readResult;
      if (done) {
        throw new Error(`Blog draft event stream ended without a terminal event: session=${session.id}`);
      }
      switch (event.type) {
        case "message.completed": {
          // Same per-step duplication `message.completed` has in run-interview.ts: a multi-step
          // session repeats earlier prose, and concatenating blindly would emit the post twice.
          if (event.data.message != null && event.data.message.length > 0 && !chunks.includes(event.data.message)) {
            chunks.push(event.data.message);
          }
          break;
        }
        case "session.completed": {
          break collect;
        }
        case "session.failed": {
          throw new Error(`Blog draft session failed: session=${session.id} code=${event.data.code} message=${event.data.message}`);
        }
        case "session.waiting": {
          throw new Error(`Blog draft session parked waiting for input in task mode: session=${session.id}`);
        }
        default: {
          break;
        }
      }
    }
  } finally {
    if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
    reader.releaseLock();
  }

  const draftMarkdown = chunks.join("\n\n").trim();
  if (draftMarkdown.length === 0) {
    // The backend maps a non-2xx to a customer-visible "try again"; an empty draft must never be
    // stored, because storing it would make the item look generated and hide the failure.
    throw new Error(`Blog draft generation produced no content: session=${session.id}`);
  }
  return { draft_markdown: draftMarkdown };
}
