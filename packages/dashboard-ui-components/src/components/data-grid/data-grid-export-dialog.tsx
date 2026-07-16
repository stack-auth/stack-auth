"use client";

import { DownloadSimpleIcon } from "@phosphor-icons/react";
import { Checkbox, cn } from "@hexclave/ui";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DesignAlert } from "../alert";
import { DesignButton } from "../button";
import { DesignDialog } from "../dialog";
import { DesignPillToggle } from "../pill-toggle";
import { DesignProgressBar } from "../progress-bar";
import { formatGridDate, resolveColumnValue } from "./state";
import type {
  DataGridColumnDef,
  DataGridExportField,
  DataGridExportFormat,
  DataGridExportOptions,
  DataGridExportScope,
} from "./types";

type ExportProgress = {
  phase: "idle" | "fetching" | "generating" | "complete";
  fetched: number;
};

type ExportCellValue = string | number | boolean | null | undefined;
type ExportTable = {
  csvHeaders: string[];
  jsonKeys: string[];
  rows: ExportCellValue[][];
};

type DataGridExportDialogProps<TRow> = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: readonly TRow[];
  columns: readonly DataGridColumnDef<TRow>[];
  exportFilename: string;
  exportOptions?: DataGridExportOptions<TRow>;
};

const idleExportProgress: ExportProgress = {
  phase: "idle",
  fetched: 0,
};
const exportCompletionDisplayMs = 800;

export function DataGridExportDialog<TRow>({
  open,
  onOpenChange,
  rows,
  columns,
  exportFilename,
  exportOptions,
}: DataGridExportDialogProps<TRow>) {
  const hasServerExport = exportOptions?.fetchRows != null;
  const resolvedFields = useMemo(
    () => exportOptions?.fields ?? buildColumnExportFields(columns),
    [exportOptions?.fields, columns],
  );
  const [format, setFormat] = useState<DataGridExportFormat>("csv");
  const [scope, setScope] = useState<DataGridExportScope>(exportOptions?.defaultScope ?? "all");
  const [fields, setFields] = useState<readonly DataGridExportField<TRow>[]>(resolvedFields);
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState<ExportProgress>(idleExportProgress);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isExporting) {
      setFields(resolvedFields);
    }
  }, [isExporting, resolvedFields]);

  // Reset the scope to its default each time the dialog opens. The dialog stays
  // mounted between opens, so without this the scope would retain whatever the
  // user last picked instead of honoring `defaultScope` on every open. We track
  // the previous `open` value with a ref so the reset only fires on a genuine
  // closed->open transition -- not on every render that flips other state (e.g.
  // `isExporting` going false after a failed/empty export would otherwise wipe
  // the user's current selection while the dialog is still open).
  const defaultScope = exportOptions?.defaultScope ?? "all";
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setScope(defaultScope);
    }
    wasOpenRef.current = open;
  }, [open, defaultScope]);

  const entityName = exportOptions?.entityName ?? "row";
  const entityNamePlural = exportOptions?.entityNamePlural ?? "rows";
  const filenamePrefix = exportOptions?.filenamePrefix ?? exportFilename;
  const title = exportOptions?.title ?? "Export data";
  const description = exportOptions?.description ?? (
    hasServerExport
      ? "Configure and download data from this table"
      : "Configure and download the rows currently loaded in this table"
  );
  const allScopeLabel = exportOptions?.allScopeLabel ?? `Export all ${entityNamePlural} in the project`;
  const filteredScopeLabel = exportOptions?.filteredScopeLabel ?? `Export only filtered/searched ${entityNamePlural}`;
  const progressSubjectLabel = exportOptions?.progressSubjectLabel ?? entityNamePlural;
  const progressTitle = progress.phase === "complete" ? "Export complete" : `Exporting ${progressSubjectLabel}`;
  const fetchExportRows = exportOptions?.fetchRows;

  const closeDialog = useCallback(() => {
    onOpenChange(false);
    setErrorMessage(null);
  }, [onOpenChange]);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (isExporting && !nextOpen) {
      return;
    }
    if (nextOpen) {
      onOpenChange(true);
    } else {
      closeDialog();
    }
  }, [closeDialog, isExporting, onOpenChange]);

  const toggleField = useCallback((key: string) => {
    setFields((prev) =>
      prev.map((field) =>
        field.key === key ? { ...field, enabled: !field.enabled } : field
      )
    );
  }, []);

  const selectAllFields = useCallback(() => {
    setFields((prev) => prev.map((field) => ({ ...field, enabled: true })));
  }, []);

  const deselectAllFields = useCallback(() => {
    setFields((prev) => prev.map((field) => ({ ...field, enabled: false })));
  }, []);

  const fetchRows = useCallback(async () => {
    if (fetchExportRows != null) {
      return await fetchExportRows({
        scope,
        onProgress: (fetched) => setProgress({ phase: "fetching", fetched }),
      });
    }

    setProgress({ phase: "fetching", fetched: rows.length });
    return rows;
  }, [fetchExportRows, rows, scope]);

  const handleExport = async () => {
    const enabledFields = fields.filter((field) => field.enabled);
    if (enabledFields.length === 0) {
      setErrorMessage("Select at least one field to export.");
      return;
    }

    setErrorMessage(null);
    setIsExporting(true);
    setProgress({ phase: "fetching", fetched: 0 });
    try {
      const exportRows = await fetchRows();

      if (exportRows.length === 0) {
        setErrorMessage(
          exportOptions?.emptyExportDescription
          ?? `There are no ${entityNamePlural} to export.`,
        );
        setIsExporting(false);
        setProgress(idleExportProgress);
        return;
      }

      setProgress({ phase: "generating", fetched: exportRows.length });
      const transformedData = buildExportTable(exportRows, enabledFields);

      if (format === "csv") {
        exportToCsv(transformedData, filenamePrefix);
      } else {
        exportToJson(transformedData, filenamePrefix);
      }

      setProgress({ phase: "complete", fetched: exportRows.length });
      await new Promise<void>((resolve) => setTimeout(resolve, exportCompletionDisplayMs));
      closeDialog();
    } catch {
      setErrorMessage("Something went wrong while exporting. Please try again.");
    } finally {
      setIsExporting(false);
      setProgress(idleExportProgress);
    }
  };

  const footer = isExporting ? (
    <DesignButton variant="secondary" disabled>
      Cancel
    </DesignButton>
  ) : (
    <>
      <DesignButton variant="secondary" onClick={closeDialog}>
        Cancel
      </DesignButton>
      <DesignButton onClick={handleExport} className="gap-2">
        <DownloadSimpleIcon className="h-4 w-4" />
        Export {titleCase(entityNamePlural)}
      </DesignButton>
    </>
  );

  return (
    <DesignDialog
      open={open}
      onOpenChange={handleOpenChange}
      icon={DownloadSimpleIcon}
      title={isExporting ? progressTitle : title}
      description={isExporting ? `Preparing export for ${progressSubjectLabel}.` : description}
      size="lg"
      hideTopCloseButton={isExporting}
      footer={footer}
    >
      {isExporting ? (
        <ExportProgressContent
          progress={progress}
          format={format}
          subjectLabel={progressSubjectLabel}
        />
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-foreground">Format</span>
            <DesignPillToggle
              options={[
                { id: "csv", label: "CSV" },
                { id: "json", label: "JSON" },
              ]}
              selected={format}
              onSelect={(id) => setFormat(id === "json" ? "json" : "csv")}
              size="sm"
              gradient="default"
              glassmorphic={false}
            />
          </div>

          {hasServerExport ? (
            <div className="space-y-2">
              <span className="text-sm font-medium text-foreground">Scope</span>
              <div className="space-y-1" role="radiogroup" aria-label="Export scope">
                <ScopeOption
                  selected={scope === "all"}
                  onSelect={() => setScope("all")}
                >
                  {allScopeLabel}
                </ScopeOption>
                <ScopeOption
                  selected={scope === "filtered"}
                  onSelect={() => setScope("filtered")}
                >
                  {filteredScopeLabel}
                </ScopeOption>
              </div>
            </div>
          ) : null}

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-foreground">Fields</span>
              <div className="flex items-center gap-1">
                <DesignButton type="button" variant="ghost" size="sm" onClick={selectAllFields} className="h-7 px-2 text-xs text-muted-foreground">
                  Select all
                </DesignButton>
                <DesignButton type="button" variant="ghost" size="sm" onClick={deselectAllFields} className="h-7 px-2 text-xs text-muted-foreground">
                  Clear
                </DesignButton>
              </div>
            </div>
            <div className="max-h-48 space-y-0.5 overflow-y-auto rounded-xl border border-foreground/[0.08] p-1.5">
              {fields.map((field) => (
                <label
                  key={field.key}
                  className="flex h-8 cursor-pointer items-center gap-2.5 rounded-lg px-2 text-sm text-foreground transition-colors duration-150 hover:bg-foreground/[0.04] hover:transition-none"
                >
                  <Checkbox
                    checked={field.enabled}
                    onCheckedChange={() => toggleField(field.key)}
                    className="border-foreground/25 shadow-none"
                  />
                  <span className="min-w-0 truncate">{field.label}</span>
                </label>
              ))}
            </div>
          </div>

          {errorMessage != null ? (
            <DesignAlert
              variant="error"
              title={exportOptions?.emptyExportTitle ?? "Export unavailable"}
              description={errorMessage}
            />
          ) : null}
        </div>
      )}
    </DesignDialog>
  );
}

function ScopeOption({
  selected,
  onSelect,
  children,
}: {
  selected: boolean,
  onSelect: () => void,
  children: React.ReactNode,
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className="flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left transition-colors duration-150 hover:bg-foreground/[0.04] hover:transition-none"
    >
      <span
        aria-hidden
        className={cn(
          "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
          selected
            ? "border-foreground bg-foreground"
            : "border-foreground/30 bg-transparent",
        )}
      >
        {selected ? <span className="h-1.5 w-1.5 rounded-full bg-background" /> : null}
      </span>
      <span className="min-w-0 text-sm text-foreground">{children}</span>
    </button>
  );
}

function ExportProgressContent(props: {
  progress: ExportProgress;
  format: DataGridExportFormat;
  subjectLabel: string;
}) {
  const { progress, format, subjectLabel } = props;
  const fileLabel = format.toUpperCase();
  const isComplete = progress.phase === "complete";
  const title = isComplete ? "Export complete" : `Exporting ${subjectLabel}`;
  const description = isComplete
    ? `Your ${fileLabel} is ready and the download should begin automatically.`
    : `Your ${fileLabel} is being prepared from matching ${subjectLabel}.`;
  const statusLabel = progress.phase === "complete"
    ? "Download ready"
    : progress.phase === "generating"
      ? `Preparing ${fileLabel}`
      : `Fetching ${subjectLabel}`;
  const countLabel = `${progress.fetched.toLocaleString()} ${isComplete ? "exported" : "fetched"}`;
  const progressValue = isComplete ? 100 : progress.phase === "generating" ? 72 : 36;

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-foreground/[0.08] bg-foreground/[0.025] p-4">
        <div className="mb-3 flex items-center justify-between gap-4 text-sm">
          <span className="font-medium text-foreground">{statusLabel}</span>
          <span className="shrink-0 tabular-nums text-muted-foreground">
            {countLabel}
          </span>
        </div>
        <DesignProgressBar
          value={progressValue}
          gradient={isComplete ? "green" : "default"}
          size="sm"
        />
        <p className="mt-3 text-xs text-muted-foreground">{description}</p>
      </div>

      <DesignAlert
        variant={isComplete ? "success" : "warning"}
        title={title}
        description={isComplete
          ? "The download should begin automatically."
          : "Keep this page open until the export finishes. The download will start automatically."}
      />
    </div>
  );
}

function buildColumnExportFields<TRow>(
  columns: readonly DataGridColumnDef<TRow>[],
): readonly DataGridExportField<TRow>[] {
  const fields: DataGridExportField<TRow>[] = [];

  for (const column of columns) {
    const label = typeof column.header === "string" ? column.header.trim() : column.id;
    if (label.length === 0) {
      continue;
    }

    fields.push({
      key: column.id,
      label,
      enabled: true,
      getValue: (row) => formatColumnExportValue(column, row),
    });
  }

  return fields;
}

function formatColumnExportValue<TRow>(
  column: DataGridColumnDef<TRow>,
  row: TRow,
): unknown {
  const value = resolveColumnValue(column, row);
  if (column.formatValue != null) {
    return column.formatValue(value, row);
  }
  if (column.type === "date" || column.type === "dateTime") {
    return formatGridDate(value, "absolute", {
      parseValue: column.parseValue,
      dateFormat: column.dateFormat,
    }).display ?? "";
  }
  return value;
}

function buildExportTable<TRow>(
  rows: readonly TRow[],
  enabledFields: readonly DataGridExportField<TRow>[],
): ExportTable {
  return {
    csvHeaders: enabledFields.map((field) => field.label),
    jsonKeys: buildJsonKeys(enabledFields),
    rows: rows.map((row) => enabledFields.map((field) => toExportCellValue(field.getValue(row)))),
  };
}

function buildJsonKeys<TRow>(
  fields: readonly DataGridExportField<TRow>[],
): string[] {
  const labelCounts = new Map<string, number>();
  for (const field of fields) {
    labelCounts.set(field.label, (labelCounts.get(field.label) ?? 0) + 1);
  }

  const usedKeys = new Map<string, true>();
  const keys: string[] = [];
  for (const field of fields) {
    const baseKey = labelCounts.get(field.label) === 1 ? field.label : `${field.label} (${field.key})`;
    let key = baseKey;
    let suffix = 2;
    while (usedKeys.has(key)) {
      key = `${baseKey} ${suffix}`;
      suffix++;
    }
    usedKeys.set(key, true);
    keys.push(key);
  }

  return keys;
}

function toExportCellValue(value: unknown): ExportCellValue {
  if (value == null) {
    return "";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function exportToCsv(data: ExportTable, filenamePrefix: string) {
  const csvContent = "\uFEFF" + [
    data.csvHeaders.map(escapeCsvCell).join(","),
    ...data.rows.map((row) => row.map(escapeCsvCell).join(",")),
  ].join("\n");
  downloadFile(csvContent, `${buildExportFilename(filenamePrefix)}.csv`, "text/csv;charset=utf-8;");
}

function escapeCsvCell(value: ExportCellValue): string {
  const rawText = String(value ?? "");
  const text = typeof value === "string" && /^[=+\-@\t\r]/.test(rawText.trimStart()) ? `'${rawText}` : rawText;
  if (text.includes(",") || text.includes('"') || text.includes("\n") || text.includes("\r")) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function exportToJson(data: ExportTable, filenamePrefix: string) {
  const rows = data.rows.map((row) => {
    const jsonRow: Record<string, ExportCellValue> = {};
    for (let i = 0; i < data.jsonKeys.length; i++) {
      jsonRow[data.jsonKeys[i]] = row[i] ?? "";
    }
    return jsonRow;
  });
  const jsonString = JSON.stringify(rows, null, 2);
  downloadFile(jsonString, `${buildExportFilename(filenamePrefix)}.json`, "application/json");
}

function downloadFile(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    URL.revokeObjectURL(url);
  }
}

function buildExportFilename(prefix: string) {
  return `${prefix}-${new Date().toISOString().split("T")[0]}`;
}

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
