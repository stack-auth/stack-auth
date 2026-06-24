"use client";

import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { ExportDataDialog, type ExportField } from "@/components/export-data-dialog";
import type { ServerTeam } from "@hexclave/next";
import type { ReactNode } from "react";

export type ExportTeamsOptions = {
  search?: string,
  createdAtOrder: "asc" | "desc",
};

const TEAM_EXPORT_FIELDS: ExportField<ServerTeam>[] = [
  { key: "id", label: "Team ID", enabled: true, getValue: (team) => team.id },
  { key: "displayName", label: "Display Name", enabled: true, getValue: (team) => team.displayName },
  { key: "createdAt", label: "Created At", enabled: true, getValue: (team) => new Date(team.createdAt).toISOString() },
];

export function ExportTeamsDialog(props: {
  trigger?: ReactNode,
  exportOptions?: ExportTeamsOptions,
  open?: boolean,
  onOpenChange?: (open: boolean) => void,
}) {
  const hexclaveAdminApp = useAdminApp();

  return (
    <ExportDataDialog
      trigger={props.trigger}
      open={props.open}
      onOpenChange={props.onOpenChange}
      title="Export Teams"
      description="Configure and download team data from your project"
      entityName="team"
      entityNamePlural="teams"
      filenamePrefix="stack-teams-export"
      fields={TEAM_EXPORT_FIELDS}
      fetchRows={async ({ scope, onProgress }) => await fetchAllTeams(
        hexclaveAdminApp,
        scope === "filtered" ? props.exportOptions : undefined,
        onProgress,
      )}
      emptyExportTitle="No teams to export"
      emptyExportDescription="There are no teams matching the current filters"
      allScopeLabel="Export all teams in the project"
      filteredScopeLabel={(
        <>
          Export only filtered/searched teams
          {props.exportOptions?.search && (
            <span className="text-muted-foreground ml-1">
              (search: &quot;{props.exportOptions.search}&quot;)
            </span>
          )}
        </>
      )}
    />
  );
}

async function fetchAllTeams(
  hexclaveAdminApp: ReturnType<typeof useAdminApp>,
  options: ExportTeamsOptions | undefined,
  onProgress: (fetched: number) => void,
): Promise<ServerTeam[]> {
  const allTeams: ServerTeam[] = [];
  let cursor: string | undefined = undefined;
  const limit = 100;

  do {
    const batch = await hexclaveAdminApp.listTeams({
      limit,
      orderBy: "createdAt",
      desc: options?.createdAtOrder !== "asc",
      cursor,
      query: options?.search,
    });

    allTeams.push(...batch);
    onProgress(allTeams.length);
    cursor = batch.nextCursor ?? undefined;
  } while (cursor);

  return allTeams;
}
