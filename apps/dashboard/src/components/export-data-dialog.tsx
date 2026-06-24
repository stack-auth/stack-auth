"use client";

import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Label,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from "@/components/ui";
import { DownloadSimpleIcon } from "@phosphor-icons/react";
import { runAsynchronouslyWithAlert } from "@hexclave/shared/dist/utils/promises";
import { download, generateCsv, mkConfig } from "export-to-csv";
import { useCallback, useState, type ReactNode } from "react";

export type ExportFormat = "csv" | "json";
export type ExportScope = "all" | "filtered";

export type ExportField<TRow> = {
  key: string,
  label: string,
  enabled: boolean,
  getValue: (row: TRow) => unknown,
};

export type ExportProgress = {
  phase: "idle" | "fetching" | "generating" | "complete",
  fetched: number,
};

type ExportCellValue = string | number | boolean | null | undefined;
type ExportRow = {
  [key: string]: ExportCellValue,
  [key: number]: ExportCellValue,
};

type ExportDataDialogProps<TRow> = {
  trigger?: ReactNode,
  open?: boolean,
  onOpenChange?: (open: boolean) => void,
  title: string,
  description: string,
  entityName: string,
  entityNamePlural: string,
  filenamePrefix: string,
  fields: ExportField<TRow>[],
  fetchRows: (options: {
    scope: ExportScope,
    onProgress: (fetched: number) => void,
  }) => Promise<TRow[]>,
  emptyExportTitle: string,
  emptyExportDescription: string,
  filteredScopeLabel?: ReactNode,
  allScopeLabel?: ReactNode,
  progressSubjectLabel?: string,
};

const idleExportProgress: ExportProgress = {
  phase: "idle",
  fetched: 0,
};
const exportCompletionDisplayMs = 800;

export function ExportDataDialog<TRow>(props: ExportDataDialogProps<TRow>) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = props.open ?? uncontrolledOpen;
  const setOpen = props.onOpenChange ?? setUncontrolledOpen;
  const [format, setFormat] = useState<ExportFormat>("csv");
  const [scope, setScope] = useState<ExportScope>("all");
  const [fields, setFields] = useState<ExportField<TRow>[]>(props.fields);
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState<ExportProgress>(idleExportProgress);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (isExporting && !nextOpen) {
      return;
    }
    setOpen(nextOpen);
  }, [isExporting, setOpen]);

  const toggleField = (key: string) => {
    setFields((prev) =>
      prev.map((field) =>
        field.key === key ? { ...field, enabled: !field.enabled } : field
      )
    );
  };

  const selectAllFields = () => {
    setFields((prev) => prev.map((field) => ({ ...field, enabled: true })));
  };

  const deselectAllFields = () => {
    setFields((prev) => prev.map((field) => ({ ...field, enabled: false })));
  };

  const handleExport = async () => {
    const enabledFields = fields.filter((field) => field.enabled);
    if (enabledFields.length === 0) {
      toast({
        title: "No fields selected",
        description: "Please select at least one field to export",
        variant: "destructive",
      });
      return;
    }

    setIsExporting(true);
    setProgress({ phase: "fetching", fetched: 0 });
    try {
      const rows = await props.fetchRows({
        scope,
        onProgress: (fetched) => setProgress({ phase: "fetching", fetched }),
      });

      if (rows.length === 0) {
        toast({
          title: props.emptyExportTitle,
          description: props.emptyExportDescription,
          variant: "destructive",
        });
        setIsExporting(false);
        setProgress(idleExportProgress);
        return;
      }

      setProgress({ phase: "generating", fetched: rows.length });
      const transformedData = rows.map((row) => transformRowData(row, enabledFields));

      if (format === "csv") {
        exportToCsv(transformedData, props.filenamePrefix);
      } else {
        exportToJson(transformedData, props.filenamePrefix);
      }

      setProgress({ phase: "complete", fetched: rows.length });
      await new Promise<void>((resolve) => setTimeout(resolve, exportCompletionDisplayMs));

      toast({
        title: "Export successful",
        description: `Exported ${rows.length} ${rows.length === 1 ? props.entityName : props.entityNamePlural}`,
        variant: "success",
      });

      setOpen(false);
    } catch (error) {
      console.error("Export failed:", error);
      toast({
        title: "Export failed",
        description: error instanceof Error ? error.message : "An unknown error occurred",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
      setProgress(idleExportProgress);
    }
  };

  return (
    <>
      {props.trigger == null ? null : (
        <div onClick={() => setOpen(true)}>
          {props.trigger}
        </div>
      )}
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {isExporting ? (
            <ExportProgressContent
              progress={progress}
              format={format}
              subjectLabel={props.progressSubjectLabel ?? props.entityNamePlural}
            />
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>{props.title}</DialogTitle>
                <DialogDescription>
                  {props.description}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-6 py-4">
                <div className="space-y-3">
                  <Label className="text-sm font-medium">Export Format</Label>
                  <Select value={format} onValueChange={(value) => setFormat(value as ExportFormat)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="csv">CSV (Comma-separated values)</SelectItem>
                      <SelectItem value="json">JSON (JavaScript Object Notation)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-3">
                  <Label className="text-sm font-medium">Export Scope</Label>
                  <RadioGroup value={scope} onValueChange={(value) => setScope(value as ExportScope)}>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="all" id={`${props.filenamePrefix}-scope-all`} />
                      <Label htmlFor={`${props.filenamePrefix}-scope-all`} className="font-normal cursor-pointer">
                        {props.allScopeLabel ?? `Export all ${props.entityNamePlural} in the project`}
                      </Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="filtered" id={`${props.filenamePrefix}-scope-filtered`} />
                      <Label htmlFor={`${props.filenamePrefix}-scope-filtered`} className="font-normal cursor-pointer">
                        {props.filteredScopeLabel ?? `Export only filtered/searched ${props.entityNamePlural}`}
                      </Label>
                    </div>
                  </RadioGroup>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium">Fields to Export</Label>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={selectAllFields}
                        className="h-7 text-xs"
                      >
                        Select All
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={deselectAllFields}
                        className="h-7 text-xs"
                      >
                        Deselect All
                      </Button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 max-h-[300px] overflow-y-auto border border-border rounded-lg p-4">
                    {fields.map((field) => (
                      <div key={field.key} className="flex items-center space-x-2">
                        <Checkbox
                          id={`${props.filenamePrefix}-field-${field.key}`}
                          checked={field.enabled}
                          onCheckedChange={() => toggleField(field.key)}
                        />
                        <Label
                          htmlFor={`${props.filenamePrefix}-field-${field.key}`}
                          className="text-sm font-normal cursor-pointer"
                        >
                          {field.label}
                        </Label>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex justify-end gap-3 pt-4">
                  <Button variant="outline" onClick={() => setOpen(false)} disabled={isExporting}>
                    Cancel
                  </Button>
                  <Button onClick={() => runAsynchronouslyWithAlert(handleExport)} disabled={isExporting}>
                    <DownloadSimpleIcon className="mr-2 h-4 w-4" />
                    Export {titleCase(props.entityNamePlural)}
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function ExportProgressContent(props: {
  progress: ExportProgress,
  format: ExportFormat,
  subjectLabel: string,
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
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          {description}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-4">
        <div className="rounded-xl border border-border bg-muted/35 p-4">
          <div className="mb-3 flex items-center justify-between gap-4 text-sm">
            <span className="font-medium text-foreground">{statusLabel}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {countLabel}
            </span>
          </div>
          <div className="relative h-2 overflow-hidden rounded-full bg-foreground/10">
            {isComplete ? (
              <div className="h-full w-full rounded-full bg-success/80" />
            ) : (
              <div className="export-progress-shimmer absolute inset-y-0 left-0 w-2/5 rounded-full bg-gradient-to-r from-transparent via-foreground/65 to-transparent" />
            )}
          </div>
        </div>

        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          Do not reload this page until the export finishes. The download will start automatically.
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="outline" disabled>
            Cancel
          </Button>
        </div>
      </div>
    </>
  );
}

function transformRowData<TRow>(
  row: TRow,
  enabledFields: ExportField<TRow>[],
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

function exportToCsv(data: ExportRow[], filenamePrefix: string) {
  const csvConfig = mkConfig({
    fieldSeparator: ",",
    filename: buildExportFilename(filenamePrefix),
    decimalSeparator: ".",
    useKeysAsHeaders: true,
  });

  const csv = generateCsv(csvConfig)(data);
  download(csvConfig)(csv);
}

function exportToJson(data: ExportRow[], filenamePrefix: string) {
  const jsonString = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonString], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${buildExportFilename(filenamePrefix)}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function buildExportFilename(prefix: string) {
  return `${prefix}-${new Date().toISOString().split("T")[0]}`;
}

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
