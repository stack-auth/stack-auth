export type CronJobDefinition = {
  id: string,
  path: string,
  schedule: string,
  localRunner: boolean,
};

export const CRON_JOB_REGISTRY: readonly CronJobDefinition[] = [
  {
    id: "email-queue",
    path: "/api/latest/internal/email-queue-step",
    schedule: "* * * * *",
    localRunner: false,
  },
  {
    id: "external-db-sync-poller",
    path: "/api/latest/internal/external-db-sync/poller",
    schedule: "* * * * *",
    localRunner: true,
  },
  {
    id: "external-db-sync-sequencer",
    path: "/api/latest/internal/external-db-sync/sequencer",
    schedule: "* * * * *",
    localRunner: true,
  },
  {
    id: "workflow-engine",
    path: "/api/latest/internal/workflow-engine-step",
    schedule: "* * * * *",
    localRunner: true,
  },
  {
    id: "issue-reconciler",
    path: "/api/latest/internal/issues/reconciler",
    schedule: "*/5 * * * *",
    localRunner: true,
  },
  {
    id: "growth-watchdog",
    path: "/api/latest/internal/growth-watchdog-step",
    schedule: "*/5 * * * *",
    localRunner: true,
  },
];

export function getLocalCronJobPaths(): readonly string[] {
  return CRON_JOB_REGISTRY.filter((job) => job.localRunner).map((job) => job.path);
}
