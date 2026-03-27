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
} from "@phosphor-icons/react";
import { generateSecureRandomString } from "@stackframe/stack-shared/dist/utils/crypto";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppEnabledGuard } from "../../app-enabled-guard";
import { PageLayout } from "../../page-layout";
import { useAdminApp } from "../../use-admin-app";
import { QueryBuilder, type QueryTable, TABLE_CONFIGS, parseSql } from "../query-builder";
import {
  ErrorDisplay,
  FolderWithId,
  RowData,
  RowDetailDialog,
  VirtualizedFlatTable
} from "../shared";

// Pagination helpers
function parseLimitFromQuery(query: string): number | null {
  const match = query.match(/\bLIMIT\s+(\d+)\b/i);
  return match ? parseInt(match[1], 10) : null;
}

function addOffsetToQuery(query: string, offset: number): string {
  if (/\bOFFSET\s+\d+\b/i.test(query)) {
    return query.replace(/\bOFFSET\s+\d+\b/i, `OFFSET ${offset}`);
  }
  return query.replace(/\bLIMIT\s+(\d+)\b/i, `LIMIT $1 OFFSET ${offset}`);
}

// Delete icon button for sidebar items
function DeleteIconButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-red-500/20 transition-colors hover:transition-none"
    >
      <TrashIcon className="h-3 w-3 text-red-500" />
    </button>
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
                    runAsynchronouslyWithAlert(handleCreate);
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
          <Button onClick={() => runAsynchronouslyWithAlert(handleCreate)} disabled={!displayName.trim() || loading}>
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
  onCreateFolder,
}: {
  open: boolean,
  onOpenChange: (open: boolean) => void,
  folders: FolderWithId[],
  sqlQuery: string,
  onSave: (displayName: string, folderId: string, description: string | null) => Promise<void>,
  onCreateFolder: () => void,
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

  const canSave = displayName.trim() && selectedFolderId && sqlQuery.trim();

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
                onChange={(e) => {
                  if (e.target.value === "__create_new__") {
                    onCreateFolder();
                  } else {
                    setSelectedFolderId(e.target.value);
                  }
                }}
              >
                <option value="">Select a folder...</option>
                {folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.displayName}
                  </option>
                ))}
                <option value="__create_new__">Create new...</option>
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
          <Button onClick={() => runAsynchronouslyWithAlert(handleSave)} disabled={!canSave || loading}>
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
          <Button variant="destructive" onClick={() => runAsynchronouslyWithAlert(handleConfirm)} disabled={loading}>
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

  // Table selection with auto-detection from SQL
  const [selectedTable, setSelectedTable] = useState<QueryTable>("events");

  const handleTableChange = useCallback((newTable: QueryTable) => {
    setSelectedTable(newTable);
    const config2 = TABLE_CONFIGS[newTable];
    setSqlQuery(`SELECT *\nFROM ${config2.sqlTable}\nORDER BY ${config2.defaultOrderBy} DESC\nLIMIT 100`);
  }, []);

  // Auto-detect table when SQL is manually edited
  useEffect(() => {
    const parsed = parseSql(sqlQuery);
    if (parsed && parsed.table !== selectedTable) {
      setSelectedTable(parsed.table);
    }
  }, [sqlQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pagination state
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [lastQueryRan, setLastQueryRan] = useState("");

  // Live mode state
  const [liveMode, setLiveMode] = useState(false);
  const runQueryRef = useRef<(q?: string) => Promise<void>>();

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
    const analyticsConfig = config.analytics;
    const queryFolders = analyticsConfig.queryFolders;

    return Object.entries(queryFolders)
      .map(([id, folder]) => ({
        id,
        displayName: folder.displayName,
        sortOrder: folder.sortOrder,
        queries: Object.entries(folder.queries).map(([queryId, query]) => ({
          id: queryId,
          displayName: query.displayName,
          sqlQuery: query.sqlQuery,
          description: query.description,
        })),
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [config]);

  const runQuery = useCallback(async (queryToRun?: string, append = false) => {
    const trimmedQuery = (queryToRun ?? sqlQuery).trim();
    if (!trimmedQuery) return;

    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
      setHasQueried(true);
    }
    setError(null);

    try {
      const response = await adminApp.queryAnalytics({
        query: trimmedQuery,
        include_all_branches: false,
        timeout_ms: 30000,
      });

      const newRows = response.result as RowData[];
      const newColumns = newRows.length > 0 ? Object.keys(newRows[0]) : [];

      if (append) {
        setRows((prev) => [...prev, ...newRows]);
      } else {
        setColumns(newColumns);
        setRows(newRows);
        setLastQueryRan(trimmedQuery);
      }

      // Detect if there might be more rows
      const limit = parseLimitFromQuery(trimmedQuery);
      setHasMore(limit !== null && newRows.length >= limit);
    } catch (e: unknown) {
      setError(e);
      if (!append) {
        setColumns([]);
        setRows([]);
      }
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [adminApp, sqlQuery]);

  runQueryRef.current = runQuery;

  const handleLoadMore = useCallback(() => {
    if (loadingMore || !hasMore || !lastQueryRan || liveMode) return;
    const query = addOffsetToQuery(lastQueryRan, rows.length);
    runAsynchronouslyWithAlert(() => runQuery(query, true));
  }, [loadingMore, hasMore, lastQueryRan, liveMode, rows.length, runQuery]);

  // Live mode polling
  const LIVE_POLL_MS = 3_000;

  useEffect(() => {
    if (!liveMode || !lastQueryRan) return;
    const interval = setInterval(() => {
      runAsynchronouslyWithAlert(() => runQueryRef.current?.(lastQueryRan) ?? Promise.resolve());
    }, LIVE_POLL_MS);
    return () => clearInterval(interval);
  }, [liveMode, lastQueryRan]);

  const handleSelectQuery = (folderId: string, query: { id: string, displayName: string, sqlQuery: string, description?: string }) => {
    setSelectedFolderId(folderId);
    setSelectedQueryId(query.id);
    setSqlQuery(query.sqlQuery);
    setError(null);
    // Auto-detect table from saved query SQL
    const parsed = parseSql(query.sqlQuery);
    if (parsed) setSelectedTable(parsed.table);
    // Run the query immediately after selecting it
    runAsynchronouslyWithAlert(() => runQuery(query.sqlQuery));
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
    // Clear selection and results if we deleted the selected folder
    if (selectedFolderId === folderId) {
      setSelectedFolderId(null);
      setSelectedQueryId(null);
      setSqlQuery("");
      setHasQueried(false);
      setRows([]);
      setColumns([]);
      setError(null);
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
    // Clear selection and results if we deleted the selected query
    if (selectedFolderId === folderId && selectedQueryId === queryId) {
      setSelectedQueryId(null);
      setSqlQuery("");
      setHasQueried(false);
      setRows([]);
      setColumns([]);
      setError(null);
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
    setLiveMode(false);
    setHasMore(false);
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
          {/* Table selector */}
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Table
            </span>
            <div className="flex gap-1">
              {(Object.keys(TABLE_CONFIGS) as QueryTable[]).map((t) => (
                <button
                  key={t}
                  onClick={() => handleTableChange(t)}
                  className={cn(
                    "px-2.5 py-1 rounded-md text-[11px] font-mono transition-colors duration-150 hover:transition-none",
                    selectedTable === t
                      ? "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 ring-1 ring-cyan-500/25"
                      : "bg-foreground/[0.04] text-muted-foreground hover:bg-foreground/[0.08]"
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Query builder accordion */}
          <details className="mb-3 group">
            <summary className="flex items-center gap-1.5 cursor-pointer select-none text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors duration-150 hover:transition-none mb-2">
              <CaretRightIcon className="h-3 w-3 transition-transform duration-150 group-open:rotate-90" />
              Query Builder
            </summary>
            <div className="mb-3">
              <QueryBuilder key={selectedTable} sql={sqlQuery} onSqlChange={setSqlQuery} table={selectedTable} />
            </div>
          </details>

          <Textarea
            value={sqlQuery}
            onChange={(e) => setSqlQuery(e.target.value)}
            placeholder={`SELECT * FROM ${TABLE_CONFIGS[selectedTable].sqlTable} ORDER BY ${TABLE_CONFIGS[selectedTable].defaultOrderBy} DESC LIMIT 100`}
            className="font-mono text-sm min-h-[80px] resize-y bg-background/60"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !loading) {
                e.preventDefault();
                runAsynchronouslyWithAlert(runQuery);
              }
            }}
          />
          <div className="flex items-center justify-between mt-2">
            <p className="text-[10px] text-muted-foreground">
              Cmd+Enter to run
            </p>
            <div className="flex items-center gap-2">
              {selectedQueryId ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => runAsynchronouslyWithAlert(handleUpdateCurrentQuery)}
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
              <Button
                size="sm"
                onClick={() => runAsynchronouslyWithAlert(runQuery)}
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
            </div>
          </div>
        </div>

        {/* Results area */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {loading && rows.length === 0 ? (
            <LoadingState />
          ) : error ? (
            <ErrorDisplay error={error} onRetry={runQuery} />
          ) : !hasQueried ? (
            <EmptyQueryState />
          ) : rows.length === 0 ? (
            <NoResultsState />
          ) : (
            <>
              {/* Header with row count + live toggle */}
              <div className="flex items-center justify-between px-4 py-2 border-b border-border/30 shrink-0">
                <span className="text-xs text-muted-foreground">
                  {rows.length.toLocaleString()} row{rows.length !== 1 ? "s" : ""}
                  {hasMore && "+"}
                  {loading && " · refreshing..."}
                </span>
                <button
                  onClick={() => {
                    if (!liveMode && !lastQueryRan) {
                      // Run query first before enabling live
                      runAsynchronouslyWithAlert(runQuery);
                    }
                    setLiveMode((prev) => !prev);
                  }}
                  className={cn(
                    "flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-medium transition-colors duration-150 hover:transition-none",
                    liveMode
                      ? "bg-green-500/15 text-green-600 dark:text-green-400 ring-1 ring-green-500/30"
                      : "bg-foreground/[0.04] text-muted-foreground hover:bg-foreground/[0.08]"
                  )}
                >
                  <span className={cn(
                    "inline-block h-1.5 w-1.5 rounded-full",
                    liveMode ? "bg-green-500 animate-pulse" : "bg-muted-foreground/40"
                  )} />
                  Live
                </button>
              </div>

              {/* Table */}
              <VirtualizedFlatTable
                columns={columns}
                rows={rows}
                onRowClick={(row) => {
                  setSelectedRow(row);
                  setDetailDialogOpen(true);
                }}
                onLoadMore={liveMode ? undefined : handleLoadMore}
                hasMore={!liveMode && hasMore}
                loadingMore={loadingMore}
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
        onCreateFolder={() => setCreateFolderDialogOpen(true)}
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
            className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-colors hover:transition-none"
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
                    className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-colors hover:transition-none"
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
