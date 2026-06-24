"use client";

import { DownloadSimpleIcon } from "@phosphor-icons/react";
import React, { useCallback, useEffect, useMemo, useState } from "react";

import { DesignButton } from "../button";
import { DesignDialog } from "../dialog";
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
type ExportRow = {
  [key: string]: ExportCellValue;
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

export function DataGridExportDialog<TRow>(props: DataGridExportDialogProps<TRow>) {
  const hasServerExport = props.exportOptions?.fetchRows != null;
  const resolvedFields = useMemo(
    () => props.exportOptions?.fields ?? buildColumnExportFields(props.columns),
    [props.exportOptions?.fields, props.columns],
  );
  const [format, setFormat] = useState<DataGridExportFormat>("csv");
  const [scope, setScope] = useState<DataGridExportScope>("all");
  const [fields, setFields] = useState<readonly DataGridExportField<TRow>[]>(resolvedFields);
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState<ExportProgress>(idleExportProgress);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isExporting) {
      setFields(resolvedFields);
    }
  }, [isExporting, resolvedFields]);

  const entityName = props.exportOptions?.entityName ?? "row";
  const entityNamePlural = props.exportOptions?.entityNamePlural ?? "rows";
  const filenamePrefix = props.exportOptions?.filenamePrefix ?? props.exportFilename;
  const title = props.exportOptions?.title ?? "Export data";
  const description = props.exportOptions?.description ?? (
    hasServerExport
      ? "Configure and download data from this table"
      : "Configure and download the rows currently loaded in this table"
  );
  const progressSubjectLabel = props.exportOptions?.progressSubjectLabel ?? entityNamePlural;
  const progressTitle = progress.phase === "complete" ? "Export complete" : `Exporting ${progressSubjectLabel}`;

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (isExporting && !nextOpen) {
      return;
    }
    props.onOpenChange(nextOpen);
    if (!nextOpen) {
      setErrorMessage(null);
    }
  }, [isExporting, props]);

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
    if (props.exportOptions?.fetchRows != null) {
      return await props.exportOptions.fetchRows({
        scope,
        onProgress: (fetched) => setProgress({ phase: "fetching", fetched }),
      });
    }

    setProgress({ phase: "fetching", fetched: props.rows.length });
    return props.rows;
  }, [props.exportOptions, props.rows, scope]);

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
          props.exportOptions?.emptyExportDescription
          ?? `There are no ${entityNamePlural} to export.`,
        );
        setIsExporting(false);
        setProgress(idleExportProgress);
        return;
      }

      setProgress({ phase: "generating", fetched: exportRows.length });
      const transformedData = exportRows.map((row) => transformRowData(row, enabledFields));

      if (format === "csv") {
        exportToCsv(transformedData, filenamePrefix);
      } else {
        exportToJson(transformedData, filenamePrefix);
      }

      setProgress({ phase: "complete", fetched: exportRows.length });
      await new Promise<void>((resolve) => setTimeout(resolve, exportCompletionDisplayMs));
      props.onOpenChange(false);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Export failed with an unknown error.");
    } finally {
      setIsExporting(false);
      setProgress(idleExportProgress);
    }
  };

  return (
    <DesignDialog
      open={props.open}
      onOpenChange={handleOpenChange}
      title={isExporting ? progressTitle : title}
      description={isExporting ? `Preparing export for ${progressSubjectLabel}.` : description}
      size="2xl"
      variant="plain"
      headerClassName={isExporting ? "sr-only" : undefined}
      hideTopCloseButton={isExporting}
    >
      {isExporting ? (
        <ExportProgressContent
          progress={progress}
          format={format}
          subjectLabel={progressSubjectLabel}
        />
      ) : (
        <div className="space-y-6">
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor={`${filenamePrefix}-export-format`}>
              Export Format
            </label>
            <select
              id={`${filenamePrefix}-export-format`}
              value={format}
              onChange={(event) => setFormat(event.currentTarget.value === "json" ? "json" : "csv")}
              className="h-9 w-full rounded-md border border-input bg-white px-3 text-sm dark:bg-background"
            >
              <option value="csv">CSV (Comma-separated values)</option>
              <option value="json">JSON (JavaScript Object Notation)</option>
            </select>
          </div>

          {hasServerExport ? (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Export Scope</legend>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="radio"
                  name={`${filenamePrefix}-export-scope`}
                  value="all"
                  checked={scope === "all"}
                  onChange={() => setScope("all")}
                />
                <span>{props.exportOptions?.allScopeLabel ?? `Export all ${entityNamePlural} in the project`}</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="radio"
                  name={`${filenamePrefix}-export-scope`}
                  value="filtered"
                  checked={scope === "filtered"}
                  onChange={() => setScope("filtered")}
                />
                <span>{props.exportOptions?.filteredScopeLabel ?? `Export only filtered/searched ${entityNamePlural}`}</span>
              </label>
            </fieldset>
          ) : null}

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <label className="text-sm font-medium">Fields to Export</label>
              <div className="flex gap-2">
                <DesignButton type="button" variant="ghost" size="sm" onClick={selectAllFields} className="h-7 text-xs">
                  Select All
                </DesignButton>
                <DesignButton type="button" variant="ghost" size="sm" onClick={deselectAllFields} className="h-7 text-xs">
                  Deselect All
                </DesignButton>
              </div>
            </div>
            <div className="grid max-h-[300px] grid-cols-1 gap-3 overflow-y-auto rounded-lg border border-border p-4 sm:grid-cols-2">
              {fields.map((field) => (
                <label key={field.key} className="flex cursor-pointer items-center gap-2 text-sm font-normal">
                  <input
                    type="checkbox"
                    checked={field.enabled}
                    onChange={() => toggleField(field.key)}
                  />
                  <span>{field.label}</span>
                </label>
              ))}
            </div>
          </div>

          {errorMessage != null ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <div className="font-medium">{props.exportOptions?.emptyExportTitle ?? "Export unavailable"}</div>
              <div>{errorMessage}</div>
            </div>
          ) : null}

          <div className="flex justify-end gap-3 pt-2">
            <DesignButton variant="outline" onClick={() => props.onOpenChange(false)}>
              Cancel
            </DesignButton>
            <DesignButton onClick={handleExport}>
              <DownloadSimpleIcon className="mr-2 h-4 w-4" />
              Export {titleCase(entityNamePlural)}
            </DesignButton>
          </div>
        </div>
      )}
    </DesignDialog>
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

  return (
    <div className="space-y-4">
      <style>
        {`
          @keyframes data-grid-export-progress-shimmer {
            0% { transform: translateX(-105%); }
            100% { transform: translateX(245%); }
          }
          .data-grid-export-progress-shimmer {
            animation: data-grid-export-progress-shimmer 1.35s ease-in-out infinite;
            will-change: transform;
          }
          @media (prefers-reduced-motion: reduce) {
            .data-grid-export-progress-shimmer {
              animation: none;
              transform: translateX(75%);
            }
          }
        `}
      </style>
      <div className="space-y-1">
        <h2 className="text-base font-semibold leading-snug">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>

      <div className="rounded-xl border border-border bg-muted/35 p-4">
        <div className="mb-3 flex items-center justify-between gap-4 text-sm">
          <span className="font-medium text-foreground">{statusLabel}</span>
          <span className="shrink-0 tabular-nums text-muted-foreground">
            {countLabel}
          </span>
        </div>
        <div className="relative h-2 overflow-hidden rounded-full bg-foreground/10">
          {isComplete ? (
            <div className="h-full w-full rounded-full bg-emerald-500/80" />
          ) : (
            <div className="data-grid-export-progress-shimmer absolute inset-y-0 left-0 w-2/5 rounded-full bg-gradient-to-r from-transparent via-foreground/65 to-transparent" />
          )}
        </div>
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
        Do not reload this page until the export finishes. The download will start automatically.
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <DesignButton variant="outline" disabled>
          Cancel
        </DesignButton>
      </div>
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

function transformRowData<TRow>(
  row: TRow,
  enabledFields: readonly DataGridExportField<TRow>[],
): ExportRow {
  const data: ExportRow = {};

  for (const field of enabledFields) {
    data[field.label] = toExportCellValue(field.getValue(row));
  }

  return data;
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

function exportToCsv(data: readonly ExportRow[], filenamePrefix: string) {
  const headers = Object.keys(data[0] ?? {});
  const csvContent = "\uFEFF" + [
    headers.map(escapeCsvCell).join(","),
    ...data.map((row) => headers.map((header) => escapeCsvCell(row[header] ?? "")).join(",")),
  ].join("\n");
  downloadFile(csvContent, `${buildExportFilename(filenamePrefix)}.csv`, "text/csv;charset=utf-8;");
}

function escapeCsvCell(value: ExportCellValue): string {
  const text = String(value ?? "");
  if (text.includes(",") || text.includes('"') || text.includes("\n")) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function exportToJson(data: readonly ExportRow[], filenamePrefix: string) {
  const jsonString = JSON.stringify(data, null, 2);
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
