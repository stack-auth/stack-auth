import { isRemoteDevelopmentEnvironmentEnabled } from "@/lib/remote-development-environment/env";
import { getRemoteDevelopmentEnvironmentDebugSnapshot } from "@/lib/remote-development-environment/manager";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function formatDuration(milliseconds: number): string {
  if (milliseconds < 1_000) return `${milliseconds}ms`;
  const seconds = Math.round(milliseconds / 1_000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

function Field(props: { label: string, value: React.ReactNode }) {
  return (
    <div className="rounded-md border border-black/10 bg-black/[0.02] px-2 py-1 dark:border-white/10 dark:bg-white/[0.03]">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{props.label}</div>
      <div className="truncate font-mono text-xs">{props.value}</div>
    </div>
  );
}

function EmptyRow(props: { colSpan: number, children: React.ReactNode }) {
  return (
    <tr>
      <td className="px-2 py-2 text-xs text-muted-foreground" colSpan={props.colSpan}>
        {props.children}
      </td>
    </tr>
  );
}

export default function RemoteDevelopmentEnvironmentDebugPage() {
  if (!isRemoteDevelopmentEnvironmentEnabled()) {
    notFound();
  }

  const snapshot = getRemoteDevelopmentEnvironmentDebugSnapshot();
  const totalTimers = snapshot.pendingSyncConfigFiles.length;
  const totalErrors = snapshot.syncErrors.length;

  return (
    <main className="min-h-screen bg-background p-3 text-foreground">
      <div className="mx-auto max-w-[1600px] space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">RDE Debug</h1>
            <p className="text-xs text-muted-foreground">
              Snapshot of the local dashboard process. Refresh to update.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-1 sm:grid-cols-6">
            <Field label="uptime" value={formatDuration(snapshot.uptimeMs)} />
            <Field label="sessions" value={snapshot.sessions.length} />
            <Field label="watchers" value={snapshot.watchedConfigFiles.length} />
            <Field label="ops" value={snapshot.activeOperations} />
            <Field label="syncs/errors" value={`${totalTimers}/${totalErrors}`} />
            <Field label="closed" value={snapshot.hasClosedSession ? "yes" : "no"} />
          </div>
        </div>

        <section className="overflow-hidden rounded-lg border border-black/10 dark:border-white/10">
          <div className="border-b border-black/10 bg-black/[0.03] px-2 py-1 text-xs font-medium dark:border-white/10 dark:bg-white/[0.04]">
            Sessions
          </div>
          <table className="w-full table-fixed text-left text-xs">
            <thead className="bg-black/[0.02] text-[10px] uppercase tracking-wide text-muted-foreground dark:bg-white/[0.03]">
              <tr>
                <th className="w-[16rem] px-2 py-1">Session</th>
                <th className="px-2 py-1">Config file</th>
                <th className="w-[8rem] px-2 py-1">Last heartbeat</th>
                <th className="w-[8rem] px-2 py-1">Expires in</th>
                <th className="w-[7rem] px-2 py-1">First HB</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.sessions.length === 0 ? <EmptyRow colSpan={5}>No active sessions.</EmptyRow> : snapshot.sessions.map((session) => (
                <tr key={session.sessionId} className="border-t border-black/5 dark:border-white/5">
                  <td className="truncate px-2 py-1 font-mono">{session.sessionId}</td>
                  <td className="truncate px-2 py-1 font-mono">{session.configFilePath}</td>
                  <td className="px-2 py-1 font-mono">{formatDuration(session.lastHeartbeatAgeMs)} ago</td>
                  <td className="px-2 py-1 font-mono">{formatDuration(session.expiresInMs)}</td>
                  <td className="px-2 py-1 font-mono">{session.receivedFirstHeartbeat ? "yes" : "no"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <div className="grid gap-3 xl:grid-cols-2">
          <section className="overflow-hidden rounded-lg border border-black/10 dark:border-white/10">
            <div className="border-b border-black/10 bg-black/[0.03] px-2 py-1 text-xs font-medium dark:border-white/10 dark:bg-white/[0.04]">
              Config Files
            </div>
            <table className="w-full table-fixed text-left text-xs">
              <thead className="bg-black/[0.02] text-[10px] uppercase tracking-wide text-muted-foreground dark:bg-white/[0.03]">
                <tr>
                  <th className="px-2 py-1">Path</th>
                  <th className="w-[7rem] px-2 py-1">Watcher</th>
                  <th className="w-[7rem] px-2 py-1">Pending sync</th>
                  <th className="w-[7rem] px-2 py-1">Updating</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.projects.length === 0 ? <EmptyRow colSpan={4}>No known project config files.</EmptyRow> : snapshot.projects.map((project) => (
                  <tr key={project.configFilePath} className="border-t border-black/5 dark:border-white/5">
                    <td className="truncate px-2 py-1 font-mono">{project.configFilePath}</td>
                    <td className="px-2 py-1 font-mono">{snapshot.watchedConfigFiles.includes(project.configFilePath) ? "yes" : "no"}</td>
                    <td className="px-2 py-1 font-mono">{snapshot.pendingSyncConfigFiles.includes(project.configFilePath) ? "yes" : "no"}</td>
                    <td className="px-2 py-1 font-mono">{snapshot.synchronouslyUpdatingConfigFiles.includes(project.configFilePath) ? "yes" : "no"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="overflow-hidden rounded-lg border border-black/10 dark:border-white/10">
            <div className="border-b border-black/10 bg-black/[0.03] px-2 py-1 text-xs font-medium dark:border-white/10 dark:bg-white/[0.04]">
              Projects
            </div>
            <table className="w-full table-fixed text-left text-xs">
              <thead className="bg-black/[0.02] text-[10px] uppercase tracking-wide text-muted-foreground dark:bg-white/[0.03]">
                <tr>
                  <th className="w-[14rem] px-2 py-1">Project</th>
                  <th className="w-[14rem] px-2 py-1">Team</th>
                  <th className="px-2 py-1">API</th>
                  <th className="w-[8rem] px-2 py-1">Updated</th>
                  <th className="w-[5rem] px-2 py-1">Hash</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.projects.length === 0 ? <EmptyRow colSpan={5}>No known projects.</EmptyRow> : snapshot.projects.map((project) => (
                  <tr key={project.configFilePath} className="border-t border-black/5 dark:border-white/5">
                    <td className="truncate px-2 py-1 font-mono">{project.projectId}</td>
                    <td className="truncate px-2 py-1 font-mono">{project.teamId}</td>
                    <td className="truncate px-2 py-1 font-mono">{project.apiBaseUrl}</td>
                    <td className="px-2 py-1 font-mono">{formatDuration(project.updatedAgoMs)} ago</td>
                    <td className="px-2 py-1 font-mono">{project.hasLastSyncedConfigHash ? "yes" : "no"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>

        <div className="grid gap-3 xl:grid-cols-3">
          <section className="overflow-hidden rounded-lg border border-black/10 dark:border-white/10">
            <div className="border-b border-black/10 bg-black/[0.03] px-2 py-1 text-xs font-medium dark:border-white/10 dark:bg-white/[0.04]">
              Local Dashboards
            </div>
            <table className="w-full table-fixed text-left text-xs">
              <thead className="bg-black/[0.02] text-[10px] uppercase tracking-wide text-muted-foreground dark:bg-white/[0.03]">
                <tr>
                  <th className="w-[5rem] px-2 py-1">Port</th>
                  <th className="w-[6rem] px-2 py-1">PID</th>
                  <th className="w-[7rem] px-2 py-1">Age</th>
                  <th className="px-2 py-1">Log</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.localDashboards.length === 0 ? <EmptyRow colSpan={4}>No dashboard entries in state.</EmptyRow> : snapshot.localDashboards.map((dashboard) => (
                  <tr key={dashboard.port} className="border-t border-black/5 dark:border-white/5">
                    <td className="px-2 py-1 font-mono">{dashboard.port}</td>
                    <td className="px-2 py-1 font-mono">{dashboard.pid}</td>
                    <td className="px-2 py-1 font-mono">{formatDuration(dashboard.startedAgoMs)}</td>
                    <td className="truncate px-2 py-1 font-mono">{dashboard.logPath ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="overflow-hidden rounded-lg border border-black/10 dark:border-white/10">
            <div className="border-b border-black/10 bg-black/[0.03] px-2 py-1 text-xs font-medium dark:border-white/10 dark:bg-white/[0.04]">
              Pending Browser Codes
            </div>
            <table className="w-full table-fixed text-left text-xs">
              <thead className="bg-black/[0.02] text-[10px] uppercase tracking-wide text-muted-foreground dark:bg-white/[0.03]">
                <tr>
                  <th className="w-[5rem] px-2 py-1">Port</th>
                  <th className="w-[7rem] px-2 py-1">Code</th>
                  <th className="w-[8rem] px-2 py-1">Expires</th>
                  <th className="px-2 py-1">Updated</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.pendingBrowserSecretConfirmationCodes.length === 0 ? <EmptyRow colSpan={4}>No pending browser confirmation codes.</EmptyRow> : snapshot.pendingBrowserSecretConfirmationCodes.map((code) => (
                  <tr key={code.port} className="border-t border-black/5 dark:border-white/5">
                    <td className="px-2 py-1 font-mono">{code.port}</td>
                    <td className="px-2 py-1 font-mono">{code.code}</td>
                    <td className="px-2 py-1 font-mono">{formatDuration(code.expiresInMs)}</td>
                    <td className="px-2 py-1 font-mono">{formatDuration(code.updatedAgoMs)} ago</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="overflow-hidden rounded-lg border border-black/10 dark:border-white/10">
            <div className="border-b border-black/10 bg-black/[0.03] px-2 py-1 text-xs font-medium dark:border-white/10 dark:bg-white/[0.04]">
              Sync Errors
            </div>
            <table className="w-full table-fixed text-left text-xs">
              <thead className="bg-black/[0.02] text-[10px] uppercase tracking-wide text-muted-foreground dark:bg-white/[0.03]">
                <tr>
                  <th className="w-[45%] px-2 py-1">Config file</th>
                  <th className="px-2 py-1">Error</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.syncErrors.length === 0 ? <EmptyRow colSpan={2}>No sync errors.</EmptyRow> : snapshot.syncErrors.map((syncError) => (
                  <tr key={syncError.configFilePath} className="border-t border-black/5 dark:border-white/5">
                    <td className="truncate px-2 py-1 font-mono">{syncError.configFilePath}</td>
                    <td className="truncate px-2 py-1 font-mono">{syncError.error}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      </div>
    </main>
  );
}
