import { deindent } from "../../../utils/strings";

// The Workflows-specific addendum served at https://skill.hexclave.com/workflows.
// It is appended verbatim after the full base skill, so this section assumes the
// reader already has the general Hexclave skill (CLI auth, config format, SDKs) in
// context and only teaches what is specific to the Workflows app.
export const workflowsSkillSection = deindent`
  # Hexclave Workflows

  Workflows are durable background automations written in TypeScript. A workflow reacts to a trigger — a platform event, your own custom event, or a cron schedule — and runs a handler made of \`step\`s. Each step's result is persisted, so a workflow can sleep for days, survive restarts, and resume without re-running work it already did.

  The app is in alpha. Enable it by adding \`"workflows-alpha": { enabled: true }\` under \`apps.installed\` (quote the key — it has a hyphen, and the \`-alpha\` suffix is part of the id).

  ## Authoring: write the code, hand it to the user

  **Workflow source cannot live in \`hexclave.config.ts\` yet.** There is no config section and no CLI command for it — the dashboard is the only way to deploy a workflow today.

  So your job is to write the TypeScript, then hand it over:

  1. Write the complete workflow file in a code block in your reply.
  2. Tell the user to open \`https://app.hexclave.com/projects/<project-id>/workflows\`, click **New workflow**, enter the id, and paste the source.
  3. Saving changed source mints a new version — every save is a deploy. Runs already in flight stay on their old version until explicitly upgraded.

  Do not try to drive the dashboard in a browser yourself, and do not invent a \`hexclave workflows\` CLI command.

  ## Writing a workflow

  \`\`\`ts
  import { workflow, customEvent, schedule, hexclaveApp, NonRetriableError } from "@hexclave/workflows";

  export default workflow("welcome-sequence", {
    on: ["user.created"],
    runKey: (event) => "user:" + event.data.id,
    onConflict: "skip",
  }, async (event, step) => {
    const user = await step.run("load-user", () => hexclaveApp.getUser(event.data.id));
    if (user == null) return;

    await step.run("send-welcome", () => sendEmail(event.data.primary_email));
    await step.sleep("wait-a-day", "1d");
    await step.run("check-in", () => sendEmail(event.data.primary_email));
  });
  \`\`\`

  Rules that matter:

  - **One workflow per file, default-exported**, and the id passed to \`workflow()\` must match the id you create in the dashboard.
  - **Self-contained source.** The only permitted imports are \`@hexclave/workflows\` and \`date-fns\`. No \`fs\`, no \`fetch\` of your own packages, no relative imports — the source is compiled and run in an isolated sandbox.
  - **All side effects go inside \`step.run\`.** Code outside a step re-executes on every resume; code inside one runs once and is memoized by step id. Never rename or reorder step ids in a version that in-flight runs will be upgraded to.
  - **Step results are persisted as plain JSON**, so a memoized SDK object comes back methodless on replay. Re-fetch a live handle inside the step that mutates.
  - \`runKey\` collapses duplicate deliveries onto one run; \`onConflict\` decides what a second event does while the first run is active (\`"skip"\`, \`"cancel-existing"\`, or \`"error"\`).
  - Throw \`NonRetriableError\` for permanent failures (bad input) so the run fails immediately instead of burning its retry budget.

  ## Triggers

  - **Platform events:** \`user.created\`, \`user.updated\`, \`user.deleted\`, \`team.created\`, \`team.updated\`, \`team.deleted\`, \`team_membership.created\`/\`.deleted\`, \`team_permission.created\`/\`.deleted\`, and \`project_permission.created\`/\`.deleted\`. These are written in the same transaction as the entity change, so delivery is at-least-once rather than best-effort. Workflows cannot trigger on other workflows' runs — there are no \`workflow.run.*\` events.
  - **Custom events:** \`customEvent("order.placed")\`, sent from your own code. The wire type gets a \`custom.\` prefix automatically — send \`"order.placed"\`, not \`"custom.order.placed"\`.
  - **Schedules:** \`schedule("0 2 * * *", { timezone: "UTC" })\`.

  ## Steps and limits

  \`step.run(id, fn, { retries, timeout })\` executes and memoizes; \`step.sleep(id, "1d")\` and \`step.sleepUntil(id, date)\` suspend the run durably (a long sleep costs nothing while it waits).

  Per step: results cap at 1 MiB, logs at 64 KiB, timeout defaults to 2 minutes and cannot exceed 10 minutes. Event payloads cap at 256 KiB. Sleeps under a minute may run inline rather than suspending.

  \`hexclaveApp\` is a real server SDK instance already authenticated to the workflow's own project — use it to read and mutate users, teams, and everything else the server SDK exposes. Its credential is scoped to server access, so admin-only surfaces (project configuration, API keys, workflow management) are not reachable from inside a workflow.

  ## Operating

  The dashboard's Workflows page is where runs are observed: each run shows its state (queued, running, sleeping, completed, failed, canceled), the step it is on, every attempt with its logs, and the trigger payload. Failed runs can be retried from the failed step, active runs can be canceled, and in-flight runs can be upgraded to a newer version — an upgrade is skipped for any run whose suspended step no longer exists in the new code.
`;
