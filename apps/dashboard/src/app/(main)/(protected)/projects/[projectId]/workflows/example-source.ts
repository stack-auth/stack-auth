// Starter source for newly created workflows. Doubles as editor example
// content: it demonstrates the core v1 concepts (durable steps, guard steps,
// runKey/onConflict, sleeps) while staying self-contained — the only allowed
// imports are "@hexclave/workflows" and the pinned stdlib ("date-fns").

export function getNewWorkflowSource(workflowId: string): string {
  return `import { workflow, hexclaveApp } from "@hexclave/workflows";

export default workflow(${JSON.stringify(workflowId)}, {
  on: ["user.created"],
  runKey: (event) => \`user:\${event.data.id}\`,
  onConflict: "skip",
}, async (event, step) => {
  // Wait a day before doing anything. Durable: survives deploys and
  // restarts; the run sleeps in the engine, not in a process.
  await step.sleep("wait-1-day", "24h");

  // Guard step: event payloads are snapshots at event time, so re-fetch
  // before every side effect. A deleted user self-cancels the run by
  // returning early.
  const user = await step.run("recheck-user", () =>
    hexclaveApp.getUser(event.data.id));
  if (user == null) return;

  await step.run("log-hello", () => {
    console.log("hello from ${workflowId}:", user.displayName ?? user.id);
  });
});
`;
}
