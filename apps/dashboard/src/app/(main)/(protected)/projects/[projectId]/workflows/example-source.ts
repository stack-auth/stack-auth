// Starter source for newly created workflows. Keep this intentionally minimal:
// the entered workflow ID must be reflected in workflow() because the backend
// rejects source whose declared ID differs from the route being created.

export function getNewWorkflowSource(workflowId: string): string {
  return `import { workflow, hexclaveApp } from "@hexclave/workflows";

export default workflow(${JSON.stringify(workflowId)}, {
  on: [],
}, async (event, step) => {

});
`;
}
