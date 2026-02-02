"use client";

import { Button } from "@/components/ui";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SimpleTooltip } from "@/components/ui/simple-tooltip";
import { Textarea } from "@/components/ui/textarea";
import { useUpdateConfig } from "@/lib/config-update";
import { cn } from "@/lib/utils";
import {
  ArrowClockwiseIcon,
  CaretDownIcon,
  CaretRightIcon,
  CheckCircleIcon,
  FilePlusIcon,
  FloppyDiskIcon,
  FolderIcon,
  FolderOpenIcon,
  PlayIcon,
  PlusIcon,
  SpinnerGapIcon,
  TrashIcon,
  WarningCircleIcon
} from "@phosphor-icons/react";
import { generateSecureRandomString } from "@stackframe/stack-shared/dist/utils/crypto";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useMemo, useRef, useState } from "react";
import { AppEnabledGuard } from "../../app-enabled-guard";
import { PageLayout } from "../../page-layout";
import { useAdminApp } from "../../use-admin-app";

type RowData = Record<string, unknown>;

type ConfigFolder = {
  displayName: string,
  sortOrder?: number,
  queries: Record<string, {
    displayName: string,
    sqlQuery: string,
    description?: string,
  }>,
};

type FolderWithId = {
  id: string,
  displayName: string,
  sortOrder: number,
  queries: Array<{
    id: string,
    displayName: string,
    sqlQuery: string,
    description?: string,
  }>,
};

// Detect if a value is a date string
function isDateValue(value: unknown): value is string {
  if (typeof value !== "string") return false;
  return /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}:\d{2})?/.test(value);
}

// Detect if a value is JSON
function isJsonValue(value: unknown): boolean {
  return typeof value === "object" && value !== null;
}

// Parse ClickHouse date string as UTC
function parseClickHouseDate(value: string): Date {
  const normalized = value.replace(" ", "T") + (value.includes("Z") || value.includes("+") ? "" : "Z");
  return new Date(normalized);
}

// Component for displaying JSON values
function JsonValue({ value, truncate = true }: { value: unknown, truncate?: boolean }) {
  const formatted = JSON.stringify(value, null, 2);
  const preview = JSON.stringify(value);

  if (truncate && preview.length > 60) {
    return (
      <SimpleTooltip tooltip={<pre className="text-xs max-w-md overflow-auto max-h-64">{formatted}</pre>}>
        <span className="cursor-help text-muted-foreground">
          {preview.slice(0, 57)}...
        </span>
      </SimpleTooltip>
    );
  }

  return <span className="text-muted-foreground">{preview}</span>;
}

// Format a cell value for display
function CellValue({ value, truncate = true }: { value: unknown, truncate?: boolean }) {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground/50">—</span>;
  }

  if (isDateValue(value)) {
    const date = parseClickHouseDate(value);
    return <span>{date.toLocaleString()}</span>;
  }

  if (isJsonValue(value)) {
    return <JsonValue value={value} truncate={truncate} />;
  }

  const str = String(value);
  if (truncate && str.length > 100) {
    return (
      <SimpleTooltip tooltip={str}>
        <span className="cursor-help">{str.slice(0, 97)}...</span>
      </SimpleTooltip>
    );
  }

  return <span>{str}</span>;
}

// Row detail dialog
function RowDetailDialog({
  row,
  columns,
  open,
  onOpenChange,
}: {
  row: RowData | null,
  columns: string[],
  open: boolean,
  onOpenChange: (open: boolean) => void,
}) {
  if (!row) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Row Details</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="space-y-4">
            {columns.map((column) => (
              <div key={column} className="space-y-1">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {column}
                </Label>
                <div className="font-mono text-sm bg-muted/30 rounded px-3 py-2 overflow-auto max-h-48">
                  {isJsonValue(row[column]) ? (
                    <pre className="whitespace-pre-wrap break-all">
                      {JSON.stringify(row[column], null, 2)}
                    </pre>
                  ) : (
                    <CellValue value={row[column]} truncate={false} />
                  )}
                </div>
              </div>
            ))}
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

// Virtualized flat table component
function VirtualizedFlatTable({
  columns,
  rows,
  onRowClick,
}: {
  columns: string[],
  rows: RowData[],
  onRowClick: (row: RowData) => void,
}) {
  const parentRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 36,
    overscan: 10,
  });

  // Column widths - distribute based on content type
  const columnWidths = useMemo(() => {
    const widths = new Map<string, string>();
    columns.forEach((col) => {
      if (col.includes("id") && col !== "project_id") {
        widths.set(col, "minmax(200px, 1fr)");
      } else if (col.includes("_at") || col.includes("date")) {
        widths.set(col, "minmax(100px, 140px)");
      } else if (col === "data" || col.includes("json")) {
        widths.set(col, "minmax(180px, 2fr)");
      } else if (col === "event_type" || col === "type") {
        widths.set(col, "minmax(100px, 160px)");
      } else {
        widths.set(col, "minmax(80px, 1fr)");
      }
    });
    return widths;
  }, [columns]);

  const gridTemplateColumns = columns.map((col) => columnWidths.get(col) ?? "1fr").join(" ");
  const minContentWidth = columns.length * 120;

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <div
        ref={parentRef}
        className="flex-1 overflow-auto"
      >
        <div style={{ minWidth: `${minContentWidth}px` }}>
          {/* Sticky header */}
          <div
            className="grid gap-3 px-3 py-1.5 border-b border-border/50 bg-muted/40 backdrop-blur-sm sticky top-0 z-10"
            style={{ gridTemplateColumns }}
          >
            {columns.map((column) => (
              <span
                key={column}
                className="font-mono text-xs font-medium text-muted-foreground"
              >
                {column}
              </span>
            ))}
          </div>

          {/* Virtualized rows container */}
          <div
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const row = rows[virtualRow.index];

              return (
                <div
                  key={virtualRow.index}
                  className={cn(
                    "absolute left-0 right-0 grid gap-3 px-3 items-center cursor-pointer",
                    "border-b border-border/30 hover:bg-muted/30 transition-colors hover:transition-none",
                    virtualRow.index % 2 === 0 ? "bg-transparent" : "bg-muted/10"
                  )}
                  style={{
                    top: `${virtualRow.start}px`,
                    height: `${virtualRow.size}px`,
                    gridTemplateColumns,
                  }}
                  onClick={() => onRowClick(row)}
                >
                  {columns.map((column) => (
                    <div key={column} className="font-mono text-[11px] truncate">
                      <CellValue value={row[column]} />
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// Error display component
function ErrorDisplay({ error, onRetry }: { error: unknown, onRetry: () => void | Promise<void> }) {
  const message = error instanceof Error ? error.message : String(error);

  return (
    <div className="flex flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="w-14 h-14 rounded-2xl bg-red-500/10 flex items-center justify-center">
        <WarningCircleIcon className="h-7 w-7 text-red-500" />
      </div>
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-1">Query Error</h3>
        <p className="text-xs text-muted-foreground max-w-md break-words font-mono whitespace-pre-wrap">
          {message}
        </p>
      </div>
      <button
        onClick={() => runAsynchronouslyWithAlert(onRetry())}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-foreground/[0.06] hover:bg-foreground/[0.1] transition-colors hover:transition-none"
      >
        <ArrowClockwiseIcon className="h-3 w-3" />
        Retry
      </button>
    </div>
  );
}

// Empty state component
function EmptyQueryState() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 p-6 text-center h-full">
      <div className="w-14 h-14 rounded-2xl bg-amber-500/10 flex items-center justify-center">
        <PlayIcon className="h-7 w-7 text-amber-500" />
      </div>
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-1">Run Query</h3>
        <p className="text-xs text-muted-foreground max-w-xs">
          Enter a ClickHouse SQL query above and click Run to see results.
        </p>
      </div>
      <div className="mt-2 p-3 rounded-lg bg-muted/30 border border-border/50 max-w-sm">
        <p className="text-[10px] text-muted-foreground/70 font-mono">
          SELECT * FROM default.events<br />
          ORDER BY event_at DESC<br />
          LIMIT 100
        </p>
      </div>
    </div>
  );
}

// No results state
function NoResultsState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 p-6 text-center h-full">
      <div className="w-12 h-12 rounded-xl bg-muted/50 flex items-center justify-center">
        <CheckCircleIcon className="h-5 w-5 text-muted-foreground" />
      </div>
      <div>
        <h3 className="text-sm font-medium text-foreground mb-0.5">No Results</h3>
        <p className="text-xs text-muted-foreground">
          Query executed successfully but returned no rows.
        </p>
      </div>
    </div>
  );
}

// Loading state component
function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 p-6 h-full">
      <SpinnerGapIcon className="h-6 w-6 text-amber-500 animate-spin" />
      <p className="text-xs text-muted-foreground">Running query...</p>
    </div>
  );
}

// Create folder dialog
function CreateFolderDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean,
  onOpenChange: (open: boolean) => void,
  onCreate: (displayName: string) => Promise<void>,
}) {
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    if (!displayName.trim()) return;
    setLoading(true);
    try {
      await onCreate(displayName.trim());
      setDisplayName("");
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Folder</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="folder-name">Folder Name</Label>
              <Input
                id="folder-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="My Queries"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    runAsynchronouslyWithAlert(handleCreate());
                  }
                }}
              />
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={!displayName.trim() || loading}>
            {loading ? "Creating..." : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Save query dialog
function SaveQueryDialog({
  open,
  onOpenChange,
  folders,
  sqlQuery,
  onSave,
}: {
  open: boolean,
  onOpenChange: (open: boolean) => void,
  folders: FolderWithId[],
  sqlQuery: string,
  onSave: (displayName: string, folderId: string, description: string | null) => Promise<void>,
}) {
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedFolderId, setSelectedFolderId] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    if (!displayName.trim() || !sqlQuery.trim() || !selectedFolderId) return;
    setLoading(true);
    try {
      await onSave(displayName.trim(), selectedFolderId, description.trim() || null);
      setDisplayName("");
      setDescription("");
      setSelectedFolderId("");
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  };

  const canSave = displayName.trim() && selectedFolderId;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save Query</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="query-name">Query Name</Label>
              <Input
                id="query-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="My Query"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="query-folder">Folder</Label>
              <select
                id="query-folder"
                className="w-full h-10 px-3 border rounded-md text-sm bg-background"
                value={selectedFolderId}
                onChange={(e) => setSelectedFolderId(e.target.value)}
              >
                <option value="">Select a folder...</option>
                {folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.displayName}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="query-description">Description (optional)</Label>
              <Textarea
                id="query-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What this query does..."
                rows={2}
              />
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave || loading}>
            {loading ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Delete confirmation dialog
function DeleteConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  onConfirm,
}: {
  open: boolean,
  onOpenChange: (open: boolean) => void,
  title: string,
  description: string,
  onConfirm: () => Promise<void>,
}) {
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <p className="text-sm text-muted-foreground">{description}</p>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={loading}>
            {loading ? "Deleting..." : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Main content component
function QueriesContent() {
  const adminApp = useAdminApp();
  const project = adminApp.useProject();
  const config = project.useConfig();
  const updateConfig = useUpdateConfig();

  // Query state
  const [sqlQuery, setSqlQuery] = useState("");
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<RowData[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [hasQueried, setHasQueried] = useState(false);
  const [selectedRow, setSelectedRow] = useState<RowData | null>(null);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);

  // Selection state
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [selectedQueryId, setSelectedQueryId] = useState<string | null>(null);

  // Dialog state
  const [createFolderDialogOpen, setCreateFolderDialogOpen] = useState(false);
  const [saveQueryDialogOpen, setSaveQueryDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ type: "folder" | "query", folderId: string, queryId?: string } | null>(null);

  // Get folders and queries from environment config
  const folders = useMemo((): FolderWithId[] => {
    // Type assertion because config types may not be updated yet
    const analyticsConfig = (config as { analytics?: { queryFolders?: Record<string, ConfigFolder> } }).analytics ?? {};
    const queryFolders = analyticsConfig.queryFolders ?? {};

    return Object.entries(queryFolders)
      .map(([id, folder]) => ({
        id,
        displayName: folder.displayName,
        sortOrder: folder.sortOrder ?? 0,
        queries: Object.entries(folder.queries).map(([queryId, query]) => ({
          id: queryId,
          displayName: query.displayName,
          sqlQuery: query.sqlQuery,
          description: query.description,
        })),
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [config]);

  const runQuery = useCallback(async (queryToRun?: string) => {
    const trimmedQuery = (queryToRun ?? sqlQuery).trim();
    if (!trimmedQuery) return;

    setLoading(true);
    setError(null);
    setHasQueried(true);

    try {
      const response = await adminApp.queryAnalytics({
        query: trimmedQuery,
        include_all_branches: false,
        timeout_ms: 30000,
      });

      const newRows = response.result as RowData[];
      const newColumns = newRows.length > 0 ? Object.keys(newRows[0]) : [];

      setColumns(newColumns);
      setRows(newRows);
    } catch (e: unknown) {
      setError(e);
      setColumns([]);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [adminApp, sqlQuery]);

  const handleSelectQuery = (folderId: string, query: { id: string, displayName: string, sqlQuery: string, description?: string }) => {
    setSelectedFolderId(folderId);
    setSelectedQueryId(query.id);
    setSqlQuery(query.sqlQuery);
    setError(null);
    // Run the query immediately after selecting it
    runAsynchronouslyWithAlert(runQuery(query.sqlQuery));
  };

  const handleCreateFolder = async (displayName: string) => {
    const folderId = generateSecureRandomString();
    await updateConfig({
      adminApp,
      configUpdate: {
        [`analytics.queryFolders.${folderId}`]: {
          displayName,
          sortOrder: folders.length,
          queries: {},
        },
      },
      pushable: false,
    });
  };

  const handleSaveQuery = async (displayName: string, folderId: string, description: string | null) => {
    const queryId = generateSecureRandomString();
    await updateConfig({
      adminApp,
      configUpdate: {
        [`analytics.queryFolders.${folderId}.queries.${queryId}`]: {
          displayName,
          sqlQuery,
          ...(description ? { description } : {}),
        },
      },
      pushable: false,
    });
  };

  const handleUpdateCurrentQuery = async () => {
    if (!selectedFolderId || !selectedQueryId) return;

    // Find the current query to get its display name and description
    const folder = folders.find(f => f.id === selectedFolderId);
    const currentQuery = folder?.queries.find(q => q.id === selectedQueryId);
    if (!currentQuery) return;

    await updateConfig({
      adminApp,
      configUpdate: {
        [`analytics.queryFolders.${selectedFolderId}.queries.${selectedQueryId}`]: {
          displayName: currentQuery.displayName,
          sqlQuery,
          ...(currentQuery.description ? { description: currentQuery.description } : {}),
        },
      },
      pushable: false,
    });
  };

  const handleDeleteFolder = async (folderId: string) => {
    await updateConfig({
      adminApp,
      configUpdate: {
        [`analytics.queryFolders.${folderId}`]: null,
      },
      pushable: false,
    });
    // Clear selection if we deleted the selected folder
    if (selectedFolderId === folderId) {
      setSelectedFolderId(null);
      setSelectedQueryId(null);
      setSqlQuery("");
    }
  };

  const handleDeleteQuery = async (folderId: string, queryId: string) => {
    await updateConfig({
      adminApp,
      configUpdate: {
        [`analytics.queryFolders.${folderId}.queries.${queryId}`]: null,
      },
      pushable: false,
    });
    // Clear selection if we deleted the selected query
    if (selectedFolderId === folderId && selectedQueryId === queryId) {
      setSelectedQueryId(null);
      setSqlQuery("");
    }
  };

  const openDeleteDialog = (type: "folder" | "query", folderId: string, queryId?: string) => {
    setDeleteTarget({ type, folderId, queryId });
    setDeleteDialogOpen(true);
  };

  const handleNewQuery = () => {
    setSelectedFolderId(null);
    setSelectedQueryId(null);
    setSqlQuery("");
    setHasQueried(false);
    setRows([]);
    setColumns([]);
    setError(null);
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    if (deleteTarget.type === "folder") {
      await handleDeleteFolder(deleteTarget.folderId);
    } else if (deleteTarget.queryId) {
      await handleDeleteQuery(deleteTarget.folderId, deleteTarget.queryId);
    }
    setDeleteTarget(null);
  };

  const getDeleteDialogInfo = () => {
    if (!deleteTarget) return { title: "", description: "" };
    if (deleteTarget.type === "folder") {
      const folder = folders.find(f => f.id === deleteTarget.folderId);
      return {
        title: "Delete Folder",
        description: `Are you sure you want to delete "${folder?.displayName ?? "this folder"}" and all its queries? This action cannot be undone.`,
      };
    }
    const folder = folders.find(f => f.id === deleteTarget.folderId);
    const query = folder?.queries.find(q => q.id === deleteTarget.queryId);
    return {
      title: "Delete Query",
      description: `Are you sure you want to delete "${query?.displayName ?? "this query"}"? This action cannot be undone.`,
    };
  };

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden -mx-2">
      {/* Left sidebar - folder list */}
      <div className="w-56 flex-shrink-0 border-r border-border/50 flex flex-col pl-2">
        <div className="flex-1 overflow-auto py-4 px-3">
          {/* New Query button */}
          <button
            onClick={handleNewQuery}
            className={cn(
              "flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-sm mb-3",
              "transition-colors hover:transition-none",
              !selectedQueryId && !selectedFolderId
                ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                : "text-muted-foreground hover:bg-foreground/[0.03] hover:text-foreground"
            )}
          >
            <FilePlusIcon className="h-4 w-4" />
            New Query
          </button>

          {/* Folders section */}
          <div className="flex items-center justify-between px-2 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-foreground/70">
              Folders
            </span>
            <SimpleTooltip tooltip="New folder">
              <button
                onClick={() => setCreateFolderDialogOpen(true)}
                className="p-1 rounded hover:bg-foreground/[0.06] text-muted-foreground hover:text-foreground transition-colors hover:transition-none"
              >
                <PlusIcon className="h-3.5 w-3.5" />
              </button>
            </SimpleTooltip>
          </div>

          {folders.length === 0 ? (
            <div className="px-2 py-4 text-center">
              <p className="text-xs text-muted-foreground mb-2">No folders yet</p>
              <button
                onClick={() => setCreateFolderDialogOpen(true)}
                className="text-xs text-blue-500 hover:text-blue-400 transition-colors hover:transition-none"
              >
                Create folder
              </button>
            </div>
          ) : (
            <div className="space-y-1">
              {folders.map((folder) => (
                <FolderItem
                  key={folder.id}
                  folder={folder}
                  selectedFolderId={selectedFolderId}
                  selectedQueryId={selectedQueryId}
                  onSelectQuery={(query) => handleSelectQuery(folder.id, query)}
                  onDeleteFolder={() => openDeleteDialog("folder", folder.id)}
                  onDeleteQuery={(queryId) => openDeleteDialog("query", folder.id, queryId)}
                />
              ))}
            </div>
          )}
        </div>

      </div>

      {/* Right content - query editor and results */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {/* Query input area */}
        <div className="p-4 border-b border-border/30">
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <Textarea
                value={sqlQuery}
                onChange={(e) => setSqlQuery(e.target.value)}
                placeholder="SELECT * FROM default.events ORDER BY event_at DESC LIMIT 100"
                className="font-mono text-sm min-h-[80px] resize-y bg-background/60"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    runAsynchronouslyWithAlert(runQuery());
                  }
                }}
              />
              <p className="text-[10px] text-muted-foreground mt-1.5">
                Cmd+Enter to run
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Button
                size="sm"
                onClick={() => runAsynchronouslyWithAlert(runQuery())}
                disabled={!sqlQuery.trim() || loading}
                className="gap-1.5"
              >
                {loading ? (
                  <SpinnerGapIcon className="h-4 w-4 animate-spin" />
                ) : (
                  <PlayIcon className="h-4 w-4" />
                )}
                Run
              </Button>
              {selectedQueryId ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => runAsynchronouslyWithAlert(handleUpdateCurrentQuery())}
                  disabled={!sqlQuery.trim()}
                  className="gap-1.5"
                >
                  <FloppyDiskIcon className="h-4 w-4" />
                  Save
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setSaveQueryDialogOpen(true)}
                  disabled={!sqlQuery.trim()}
                  className="gap-1.5"
                >
                  <FloppyDiskIcon className="h-4 w-4" />
                  Save
                </Button>
              )}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setSaveQueryDialogOpen(true)}
                disabled={!sqlQuery.trim()}
                className="gap-1.5 text-xs"
              >
                Save As...
              </Button>
            </div>
          </div>
        </div>

        {/* Results area */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {loading ? (
            <LoadingState />
          ) : error ? (
            <ErrorDisplay error={error} onRetry={runQuery} />
          ) : !hasQueried ? (
            <EmptyQueryState />
          ) : rows.length === 0 ? (
            <NoResultsState />
          ) : (
            <>
              {/* Header with row count */}
              <div className="flex items-center justify-between px-4 py-2 border-b border-border/30 shrink-0">
                <span className="text-xs text-muted-foreground">
                  {rows.length.toLocaleString()} row{rows.length !== 1 ? "s" : ""}
                </span>
              </div>

              {/* Table */}
              <VirtualizedFlatTable
                columns={columns}
                rows={rows}
                onRowClick={(row) => {
                  setSelectedRow(row);
                  setDetailDialogOpen(true);
                }}
              />
            </>
          )}
        </div>
      </div>

      {/* Dialogs */}
      <CreateFolderDialog
        open={createFolderDialogOpen}
        onOpenChange={setCreateFolderDialogOpen}
        onCreate={handleCreateFolder}
      />
      <SaveQueryDialog
        open={saveQueryDialogOpen}
        onOpenChange={setSaveQueryDialogOpen}
        folders={folders}
        sqlQuery={sqlQuery}
        onSave={handleSaveQuery}
      />
      <DeleteConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        {...getDeleteDialogInfo()}
        onConfirm={handleConfirmDelete}
      />
      <RowDetailDialog
        row={selectedRow}
        columns={columns}
        open={detailDialogOpen}
        onOpenChange={setDetailDialogOpen}
      />
    </div>
  );
}

// Folder item component
function FolderItem({
  folder,
  selectedFolderId,
  selectedQueryId,
  onSelectQuery,
  onDeleteFolder,
  onDeleteQuery,
}: {
  folder: FolderWithId,
  selectedFolderId: string | null,
  selectedQueryId: string | null,
  onSelectQuery: (query: { id: string, displayName: string, sqlQuery: string, description?: string }) => void,
  onDeleteFolder: () => void,
  onDeleteQuery: (queryId: string) => void,
}) {
  const [expanded, setExpanded] = useState(false);
  const isSelected = selectedFolderId === folder.id;

  return (
    <div>
      <div className="group flex items-center">
        <button
          onClick={() => setExpanded(!expanded)}
          className={cn(
            "flex items-center gap-1.5 flex-1 px-2 py-1.5 rounded-md text-sm",
            "text-muted-foreground hover:bg-foreground/[0.03] hover:text-foreground",
            "transition-colors hover:transition-none"
          )}
        >
          {expanded ? (
            <CaretDownIcon className="h-3 w-3 shrink-0" />
          ) : (
            <CaretRightIcon className="h-3 w-3 shrink-0" />
          )}
          {expanded ? (
            <FolderOpenIcon className="h-4 w-4 text-amber-500 shrink-0" />
          ) : (
            <FolderIcon className="h-4 w-4 text-amber-500 shrink-0" />
          )}
          <span className="truncate flex-1 text-left">{folder.displayName}</span>
          <span className="text-xs text-muted-foreground/60 shrink-0">
            {folder.queries.length}
          </span>
        </button>
        <SimpleTooltip tooltip="Delete folder">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDeleteFolder();
            }}
            className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-opacity"
          >
            <TrashIcon className="h-3.5 w-3.5" />
          </button>
        </SimpleTooltip>
      </div>
      {expanded && (
        <div className="ml-5 mt-0.5 space-y-0.5">
          {folder.queries.length === 0 ? (
            <div className="px-2 py-1 text-xs text-muted-foreground/60 italic">
              Empty
            </div>
          ) : (
            folder.queries.map((query) => (
              <div key={query.id} className="group flex items-center">
                <button
                  onClick={() => onSelectQuery(query)}
                  className={cn(
                    "flex-1 text-left px-2 py-1 rounded-md text-sm truncate",
                    "transition-colors hover:transition-none",
                    isSelected && selectedQueryId === query.id
                      ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                      : "text-muted-foreground hover:bg-foreground/[0.03] hover:text-foreground"
                  )}
                >
                  {query.displayName}
                </button>
                <SimpleTooltip tooltip="Delete query">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteQuery(query.id);
                    }}
                    className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-opacity"
                  >
                    <TrashIcon className="h-3 w-3" />
                  </button>
                </SimpleTooltip>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default function PageClient() {
  return (
    <AppEnabledGuard appId="analytics">
      <PageLayout fillWidth noPadding>
        <QueriesContent />
      </PageLayout>
    </AppEnabledGuard>
  );
}
