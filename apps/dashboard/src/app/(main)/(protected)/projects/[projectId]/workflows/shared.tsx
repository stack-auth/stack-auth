"use client";

import { codePanelHeaderClasses, codePanelShellClasses } from "@/components/code-block";
import {
  DesignAlert,
  DesignBadge,
  DesignButton,
  DesignMetricCard,
  DesignSelectorDropdown,
} from "@/components/design-components";
import { cn } from "@/components/ui";
import { useTheme } from "@/lib/theme";
import Editor, { DiffEditor, type Monaco } from "@monaco-editor/react";
import {
  BroadcastIcon,
  CalendarBlankIcon,
  ChartLineIcon,
  LightningIcon,
  MoonIcon,
  PlayIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import {
  applyQuickSearch,
  buildRowComparator,
  createDefaultDataGridState,
  DataGrid,
  defaultMatchRow,
  useDataSource,
  type DataGridColumnDef,
  type DataGridDataSource,
} from "@hexclave/dashboard-ui-components";
import { useMemo, useState } from "react";
import {
  getInFlightRunCount,
  getRuns7d,
  getRunStateBadgeColor,
  getRunStateLabel,
  getRunsForWorkflow,
  getVersionsForWorkflow,
  getWorkflowById,
  getWorkflowFileName,
  MOCK_WORKFLOWS,
  type MockRun,
  type MockTrigger,
  type MockVersion,
  type MockWorkflow,
  type RunState,
} from "./mock-data";

// Building blocks for the Workflows page: the two infinite-scroll grids
// (same pattern as the Users page), the workflow header pieces, and the
// always-editable code panel where saving mints a new version (a post-v1
// exploration; the v1 spec keeps dashboard code read-only).

export type WorkflowDetailProps = {
  selectedWorkflowId: string | null,
  onSelect: (workflowId: string) => void,
  onClose: () => void,
};

const TRIGGER_ICONS = new Map<MockTrigger["kind"], React.ElementType>([
  ["platform", LightningIcon],
  ["custom", BroadcastIcon],
  ["schedule", CalendarBlankIcon],
]);

export function TriggerChip({ trigger }: { trigger: MockTrigger }) {
  const TriggerIcon = TRIGGER_ICONS.get(trigger.kind) ?? LightningIcon;
  return (
    <span className="inline-flex items-center gap-1 rounded-lg bg-foreground/[0.05] px-2 py-0.5 font-mono text-[11px] text-foreground/80">
      <TriggerIcon className="h-3 w-3 shrink-0 text-muted-foreground" />
      {trigger.label}
    </span>
  );
}

/** The slug + version + trigger chips row atop the workflow detail. */
export function WorkflowTitleRow({ workflow }: { workflow: MockWorkflow }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-mono text-lg font-semibold">{workflow.id}</span>
      <DesignBadge label={`v${workflow.currentVersion}`} color="blue" size="sm" />
      {workflow.triggers.map((trigger) => <TriggerChip key={trigger.label} trigger={trigger} />)}
    </div>
  );
}

/** Workflow-scoped KPI cards. */
export function WorkflowKpiRow({ workflow }: { workflow: MockWorkflow }) {
  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <DesignMetricCard label="Active runs" value={workflow.activeRuns} icon={PlayIcon} gradient="blue" />
      <DesignMetricCard label="Sleeping runs" value={workflow.sleepingRuns.toLocaleString()} icon={MoonIcon} gradient="purple" />
      <DesignMetricCard label="Runs · 7d" value={getRuns7d(workflow).toLocaleString()} icon={ChartLineIcon} gradient="cyan" />
      <DesignMetricCard label="Failed · 7d" value={workflow.failed7d} icon={WarningCircleIcon} gradient="orange" />
    </div>
  );
}

// ─── Infinite-scroll plumbing (same pattern as the Users page grid) ────────

const INFINITE_PAGE_SIZE = 25;

/**
 * Wraps an in-memory row array in the async-generator data-source contract
 * the Users page uses, so both grids get real infinite scrolling (cursor =
 * offset). Search and sorting are applied server-side-style inside the
 * generator, exactly like a paginated API would.
 */
function createMockDataSource<TRow>(
  getRows: () => TRow[],
  columns: readonly DataGridColumnDef<TRow>[],
): DataGridDataSource<TRow> {
  return async function* (params) {
    const offset = typeof params.cursor === "string" ? Number(params.cursor) : 0;
    let rows = getRows();
    const query = typeof params.quickSearch === "string" ? params.quickSearch.trim() : "";
    if (query.length > 0) {
      rows = [...applyQuickSearch(rows, query, columns, defaultMatchRow)];
    }
    const comparator = buildRowComparator(params.sorting, columns);
    if (comparator != null) {
      rows = [...rows].sort(comparator);
    }
    const nextOffset = offset + INFINITE_PAGE_SIZE;
    yield {
      rows: rows.slice(offset, nextOffset),
      hasMore: nextOffset < rows.length,
      nextCursor: nextOffset < rows.length ? String(nextOffset) : undefined,
    };
  };
}

// ─── Workflows table (level 1) ─────────────────────────────────────────────

const workflowColumns: DataGridColumnDef<MockWorkflow>[] = [
  {
    id: "id",
    header: "Workflow",
    accessor: "id",
    width: 250,
    type: "string",
    renderCell: ({ row }) => (
      <div className="flex min-w-0 flex-col">
        <span className="truncate font-mono text-xs font-medium">{row.id}</span>
        <span className="truncate text-[11px] text-muted-foreground">{row.displayName}</span>
      </div>
    ),
  },
  {
    id: "triggers",
    header: "Triggers",
    accessor: (workflow) => workflow.triggers.map((trigger) => trigger.label).join(", "),
    width: 230,
    type: "string",
    cellOverflow: "wrap",
    renderCell: ({ row }) => (
      <div className="flex flex-wrap gap-1 py-1">
        {row.triggers.map((trigger) => <TriggerChip key={trigger.label} trigger={trigger} />)}
      </div>
    ),
  },
  {
    id: "currentVersion",
    header: "Version",
    accessor: "currentVersion",
    width: 85,
    type: "number",
    align: "left",
    renderCell: ({ row }) => <span className="font-mono text-xs">v{row.currentVersion}</span>,
  },
  {
    id: "inFlight",
    header: "In-flight runs",
    accessor: (workflow) => getInFlightRunCount(workflow),
    width: 115,
    type: "number",
    align: "right",
    renderCell: ({ row }) => {
      const count = getInFlightRunCount(row);
      return (
        <div className="flex w-full flex-col items-end">
          <span className="text-xs tabular-nums">{count.toLocaleString()}</span>
          {row.pausedRuns > 0 && (
            <span className="text-[10px] text-amber-600 dark:text-amber-400">{row.pausedRuns} paused</span>
          )}
        </div>
      );
    },
  },
  {
    id: "runs7d",
    header: "Runs (7d)",
    accessor: (workflow) => getRuns7d(workflow),
    width: 100,
    type: "number",
    align: "right",
    renderCell: ({ row }) => <span className="text-xs tabular-nums">{getRuns7d(row).toLocaleString()}</span>,
  },
  {
    id: "failed7d",
    header: "Failed (7d)",
    accessor: "failed7d",
    width: 100,
    type: "number",
    align: "right",
    renderCell: ({ row }) => (
      <span className={cn("text-xs tabular-nums", row.failed7d > 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>
        {row.failed7d}
      </span>
    ),
  },
  {
    id: "lastDeploy",
    header: "Last deploy",
    accessor: (workflow) => workflow.lastDeploy.at,
    width: 110,
    type: "string",
    renderCell: ({ row }) => (
      <span className="text-[11px] text-muted-foreground">{row.lastDeploy.at}</span>
    ),
  },
];

const workflowsDataSource = createMockDataSource(() => MOCK_WORKFLOWS, workflowColumns);

function getWorkflowRowId(workflow: MockWorkflow): string {
  return workflow.id;
}

/** The level-1 workflows table — infinite-scroll grid, same as the Users page. */
export function WorkflowsTable({ onOpen }: { onOpen: (workflowId: string) => void }) {
  const [gridState, setGridState] = useState(() => createDefaultDataGridState(workflowColumns));
  const gridData = useDataSource({
    dataSource: workflowsDataSource,
    columns: workflowColumns,
    getRowId: getWorkflowRowId,
    sorting: gridState.sorting,
    quickSearch: gridState.quickSearch,
    pagination: gridState.pagination,
    paginationMode: "infinite",
  });

  return (
    <DataGrid
      columns={workflowColumns}
      rows={gridData.rows}
      getRowId={getWorkflowRowId}
      isLoading={gridData.isLoading}
      isRefetching={gridData.isRefetching}
      state={gridState}
      onChange={setGridState}
      onRowClick={(workflow) => onOpen(workflow.id)}
      paginationMode="infinite"
      hasMore={gridData.hasMore}
      isLoadingMore={gridData.isLoadingMore}
      onLoadMore={gridData.loadMore}
      footer={false}
      rowHeight="auto"
      estimatedRowHeight={52}
      maxHeight={620}
    />
  );
}

// ─── Runs grid ─────────────────────────────────────────────────────────────

const ALL_RUN_STATES: RunState[] = ["queued", "running", "sleeping", "paused", "failed", "completed", "canceled"];
const RUN_STATE_OPTIONS = ALL_RUN_STATES.map((state) => ({ value: state, label: getRunStateLabel(state) }));

const runColumns: DataGridColumnDef<MockRun>[] = [
  {
    id: "runKey",
    header: "Run key",
    accessor: (run) => run.runKey ?? run.uuid,
    width: 200,
    type: "string",
    renderCell: ({ row }) => (
      <span className="font-mono text-xs">
        {row.runKey ?? <span className="text-muted-foreground">{row.uuid} · keyless</span>}
      </span>
    ),
  },
  {
    id: "state",
    header: "State",
    accessor: "state",
    width: 115,
    type: "singleSelect",
    valueOptions: RUN_STATE_OPTIONS,
    renderCell: ({ row }) => (
      <DesignBadge label={getRunStateLabel(row.state)} color={getRunStateBadgeColor(row.state)} size="sm" />
    ),
  },
  {
    id: "version",
    header: "Version",
    accessor: "version",
    width: 100,
    type: "number",
    align: "left",
    renderCell: ({ row }) => {
      const isLatest = row.version === getWorkflowById(row.workflowId).currentVersion;
      return (
        <span className={cn("font-mono text-xs", isLatest ? "" : "text-muted-foreground")}>
          v{row.version}{isLatest ? "" : " (pinned)"}
        </span>
      );
    },
  },
  {
    id: "trigger",
    header: "Trigger",
    accessor: (run) => `${run.trigger} ${run.triggerSummary}`,
    width: 220,
    type: "string",
    renderCell: ({ row }) => (
      <div className="flex min-w-0 flex-col">
        <span className="truncate font-mono text-[11px]">{row.trigger}</span>
        <span className="truncate text-[11px] text-muted-foreground">{row.triggerSummary}</span>
      </div>
    ),
  },
  {
    id: "currentStep",
    header: "Current step",
    accessor: (run) => run.currentStep ?? "",
    width: 170,
    type: "string",
    renderCell: ({ row }) => (
      row.currentStep == null
        ? <span className="text-xs text-muted-foreground">—</span>
        : <span className="font-mono text-xs">{row.currentStep}</span>
    ),
  },
  { id: "startedAt", header: "Started", accessor: "startedAt", width: 100, type: "string" },
  {
    id: "nextWakeAt",
    header: "Next wake",
    accessor: (run) => run.nextWakeAt ?? "",
    width: 100,
    type: "string",
    renderCell: ({ row }) => (
      row.nextWakeAt == null
        ? <span className="text-xs text-muted-foreground">—</span>
        : <span className="text-xs">{row.nextWakeAt}</span>
    ),
  },
];

function getRunRowId(run: MockRun): string {
  return run.uuid;
}

/** This workflow's runs — infinite-scroll DataGrid, same pattern as the Users page. */
export function WorkflowRunsGrid({ workflowId, maxHeight = 520 }: { workflowId: string, maxHeight?: number }) {
  const [gridState, setGridState] = useState(() => createDefaultDataGridState(runColumns));
  const dataSource = useMemo(
    () => createMockDataSource(() => getRunsForWorkflow(workflowId), runColumns),
    [workflowId],
  );
  const gridData = useDataSource({
    dataSource,
    columns: runColumns,
    getRowId: getRunRowId,
    sorting: gridState.sorting,
    quickSearch: gridState.quickSearch,
    pagination: gridState.pagination,
    paginationMode: "infinite",
  });

  return (
    <DataGrid
      columns={runColumns}
      rows={gridData.rows}
      getRowId={getRunRowId}
      isLoading={gridData.isLoading}
      isRefetching={gridData.isRefetching}
      state={gridState}
      onChange={setGridState}
      paginationMode="infinite"
      hasMore={gridData.hasMore}
      isLoadingMore={gridData.isLoadingMore}
      onLoadMore={gridData.loadMore}
      footer={false}
      rowHeight="auto"
      estimatedRowHeight={44}
      maxHeight={maxHeight}
    />
  );
}

// ─── Code: always-editable panel with version selector ────────────────────

export type WorkflowVersionsController = {
  workflowId: string,
  versions: MockVersion[],
  selectedVersion: number,
  setSelectedVersion: (version: number) => void,
  selected: MockVersion,
  saveNewVersion: (code: string) => number,
  lastSavedVersion: number | null,
};

/**
 * Versions of a workflow plus any versions minted locally by the code panel
 * ("save creates a new version"). Local versions exist only in component
 * state — nothing is persisted.
 */
export function useWorkflowVersions(workflowId: string): WorkflowVersionsController {
  const [localVersions, setLocalVersions] = useState<MockVersion[]>([]);
  const [lastSavedVersion, setLastSavedVersion] = useState<number | null>(null);

  const baseVersions = getVersionsForWorkflow(workflowId);
  const versions = useMemo(() => {
    if (localVersions.length === 0) return baseVersions;
    return [
      ...localVersions.map((version, index) => ({ ...version, isCurrent: index === 0 })),
      ...baseVersions.map((version) => ({ ...version, isCurrent: false })),
    ];
  }, [localVersions, baseVersions]);

  const currentVersion = versions.find((version) => version.isCurrent);
  if (currentVersion == null) {
    throw new Error(`Workflow "${workflowId}" has no current version — mock data must mark exactly one version current`);
  }

  const [selectedVersion, setSelectedVersion] = useState(currentVersion.version);
  // Adjust-state-during-render reset when the caller switches workflows.
  const [lastWorkflowId, setLastWorkflowId] = useState(workflowId);
  if (lastWorkflowId !== workflowId) {
    setLastWorkflowId(workflowId);
    setLocalVersions([]);
    setLastSavedVersion(null);
    setSelectedVersion(getVersionsForWorkflow(workflowId).find((version) => version.isCurrent)?.version ?? 1);
  }

  const selected = versions.find((version) => version.version === selectedVersion) ?? currentVersion;

  const saveNewVersion = (code: string): number => {
    const nextVersion = versions[0].version + 1;
    const minted: MockVersion = {
      version: nextVersion,
      deployedAt: "just now",
      activeRuns: 0,
      sleepingRuns: 0,
      pausedRuns: 0,
      isCurrent: true,
      code,
    };
    setLocalVersions((existing) => [minted, ...existing]);
    setSelectedVersion(nextVersion);
    setLastSavedVersion(nextVersion);
    return nextVersion;
  };

  return { workflowId, versions, selectedVersion, setSelectedVersion, selected, saveNewVersion, lastSavedVersion };
}

function inFlightRunsOnVersion(version: MockVersion): number {
  return version.activeRuns + version.sleepingRuns + version.pausedRuns;
}

function versionSelectorOptions(versions: MockVersion[]) {
  return versions.map((version) => ({
    value: String(version.version),
    label: `v${version.version}${version.isCurrent ? " (latest)" : ""} · deployed ${version.deployedAt}`,
  }));
}

/**
 * The code tab's panel. The latest version is editable in Monaco with a
 * Save button that enables on any change and mints the next version; older
 * versions render in the same editor read-only, with an upgrade-runs action
 * in the Save button's place. The deploy label in the editor header opens a
 * side-by-side diff viewer with its own pair of version selectors.
 */
export function EditableCodePanel({ controller, height = 460 }: { controller: WorkflowVersionsController, height?: number }) {
  const { resolvedTheme } = useTheme();
  const [draft, setDraft] = useState(controller.selected.code);
  const [diff, setDiff] = useState<{ baseVersion: number, targetVersion: number } | null>(null);

  // Reset the draft whenever the shown version changes (including right
  // after a save, when the selection jumps to the freshly minted version).
  // The diff view only closes when the WORKFLOW changes — its version pair
  // would dangle otherwise.
  const draftKey = `${controller.workflowId}:${controller.selectedVersion}`;
  const [lastDraftKey, setLastDraftKey] = useState(draftKey);
  if (lastDraftKey !== draftKey) {
    const workflowChanged = !lastDraftKey.startsWith(`${controller.workflowId}:`);
    setLastDraftKey(draftKey);
    setDraft(controller.selected.code);
    if (workflowChanged) setDiff(null);
    return null;
  }

  const isCurrent = controller.selected.isCurrent;
  const isDirty = isCurrent && draft !== controller.selected.code;
  const nextVersion = controller.versions[0].version + 1;
  const inFlight = inFlightRunsOnVersion(controller.selected);
  const monacoTheme = resolvedTheme === "dark" ? "vs-dark" : "light";

  const getVersionOrThrow = (versionNumber: number): MockVersion => {
    const version = controller.versions.find((v) => v.version === versionNumber);
    if (version == null) {
      throw new Error(`Version v${versionNumber} not found — diff selectors only offer existing versions`);
    }
    return version;
  };

  const openDiff = () => {
    // Default comparison: the shown version against the one deployed right
    // before it (or against the next newer one when the oldest is shown).
    const index = controller.versions.findIndex((version) => version.version === controller.selectedVersion);
    const older = index + 1 < controller.versions.length ? controller.versions[index + 1] : null;
    if (older != null) {
      setDiff({ baseVersion: older.version, targetVersion: controller.selectedVersion });
    } else {
      setDiff({ baseVersion: controller.selectedVersion, targetVersion: controller.versions[index - 1].version });
    }
  };

  const handleBeforeMount = (monaco: Monaco) => {
    // The mock code imports packages Monaco can't resolve here; keep syntax
    // checking but drop semantic validation so the editor isn't a sea of red.
    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: true,
      noSyntaxValidation: false,
    });
  };

  if (diff != null) {
    const baseVersion = getVersionOrThrow(diff.baseVersion);
    const targetVersion = getVersionOrThrow(diff.targetVersion);
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <DesignSelectorDropdown
              value={String(diff.baseVersion)}
              onValueChange={(value) => setDiff({ baseVersion: Number(value), targetVersion: diff.targetVersion })}
              options={versionSelectorOptions(controller.versions)}
              size="sm"
            />
            <span className="text-xs text-muted-foreground">→</span>
            <DesignSelectorDropdown
              value={String(diff.targetVersion)}
              onValueChange={(value) => setDiff({ baseVersion: diff.baseVersion, targetVersion: Number(value) })}
              options={versionSelectorOptions(controller.versions)}
              size="sm"
            />
          </div>
          <DesignButton size="sm" variant="secondary" onClick={() => setDiff(null)}>
            Close diff
          </DesignButton>
        </div>

        <div className={codePanelShellClasses}>
          <div className={codePanelHeaderClasses}>
            <span className="font-mono text-xs">{getWorkflowFileName(controller.workflowId)}</span>
            <span className="text-[11px] text-muted-foreground">v{baseVersion.version} → v{targetVersion.version}</span>
          </div>
          <DiffEditor
            height={height}
            language="typescript"
            original={baseVersion.code}
            modified={targetVersion.code}
            theme={monacoTheme}
            beforeMount={handleBeforeMount}
            options={{
              readOnly: true,
              renderSideBySide: true,
              minimap: { enabled: false },
              fontSize: 12,
              scrollBeyondLastLine: false,
              automaticLayout: true,
              padding: { top: 12, bottom: 12 },
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <DesignSelectorDropdown
          value={String(controller.selectedVersion)}
          onValueChange={(value) => controller.setSelectedVersion(Number(value))}
          options={versionSelectorOptions(controller.versions)}
          size="sm"
        />
        {isCurrent ? (
          <DesignButton
            size="sm"
            onClick={() => {
              controller.saveNewVersion(draft);
            }}
            disabled={!isDirty}
          >
            Save as v{nextVersion}
          </DesignButton>
        ) : inFlight > 0 ? (
          // Mock action — intentionally inert in this prototype.
          <DesignButton size="sm" variant="outline">
            Upgrade {inFlight.toLocaleString()} run{inFlight === 1 ? "" : "s"} to v{controller.versions[0].version}
          </DesignButton>
        ) : null}
      </div>

      {controller.lastSavedVersion != null && controller.selectedVersion === controller.lastSavedVersion && !isDirty && (
        <DesignAlert
          variant="success"
          title={`v${controller.lastSavedVersion} deployed`}
          description="New runs start on this version. In-flight runs stay pinned to the version they started on until you explicitly upgrade them."
        />
      )}

      <div className={codePanelShellClasses}>
        <div className={codePanelHeaderClasses}>
          <span className="font-mono text-xs">{getWorkflowFileName(controller.workflowId)}</span>
          {controller.versions.length > 1 ? (
            <button
              type="button"
              onClick={openDiff}
              className="text-[11px] text-blue-600 transition-colors duration-150 hover:underline hover:transition-none dark:text-blue-400"
            >
              {isCurrent ? "latest" : `v${controller.selectedVersion}`} · deployed {controller.selected.deployedAt}
            </button>
          ) : (
            <span className="text-[11px] text-muted-foreground">
              {isCurrent ? "latest" : `v${controller.selectedVersion}`} · deployed {controller.selected.deployedAt}
            </span>
          )}
        </div>
        <Editor
          height={height}
          language="typescript"
          value={isCurrent ? draft : controller.selected.code}
          onChange={(value) => {
            if (isCurrent) setDraft(value ?? "");
          }}
          theme={monacoTheme}
          beforeMount={handleBeforeMount}
          options={{
            readOnly: !isCurrent,
            minimap: { enabled: false },
            fontSize: 12,
            scrollBeyondLastLine: false,
            wordWrap: "on",
            automaticLayout: true,
            padding: { top: 12, bottom: 12 },
          }}
        />
      </div>
    </div>
  );
}
