"use client";

import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { DownloadSimpleIcon } from "@phosphor-icons/react";
import type { ServerUser } from "@hexclave/next";
import { runAsynchronouslyWithAlert } from "@hexclave/shared/dist/utils/promises";
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
import { download, generateCsv, mkConfig } from "export-to-csv";
import { useCallback, useState } from "react";

type ExportFormat = "csv" | "json";
type ExportScope = "all" | "filtered";

type ExportField = {
  key: string,
  label: string,
  enabled: boolean,
};

type ExportOptions = {
  search?: string,
  includeRestricted: boolean,
  includeAnonymous: boolean,
  onlyAnonymous?: boolean,
  excludedEmailDomains: string[],
};

type ExportProgress = {
  phase: "idle" | "fetching" | "generating" | "complete",
  fetched: number,
};

const idleExportProgress: ExportProgress = {
  phase: "idle",
  fetched: 0,
};
const exportCompletionDisplayMs = 800;

const DEFAULT_FIELDS: ExportField[] = [
  { key: "id", label: "User ID", enabled: true },
  { key: "displayName", label: "Display Name", enabled: true },
  { key: "primaryEmail", label: "Email", enabled: true },
  { key: "primaryEmailVerified", label: "Email Verified", enabled: true },
  { key: "signedUpAt", label: "Signed Up At", enabled: true },
  { key: "lastActiveAt", label: "Last Active At", enabled: true },
  { key: "isAnonymous", label: "Is Anonymous", enabled: false },
  { key: "hasPassword", label: "Has Password", enabled: false },
  { key: "otpAuthEnabled", label: "OTP Auth Enabled", enabled: false },
  { key: "passkeyAuthEnabled", label: "Passkey Auth Enabled", enabled: false },
  { key: "isMultiFactorRequired", label: "Multi-Factor Required", enabled: false },
  { key: "oauthProviders", label: "OAuth Providers", enabled: false },
  { key: "profileImageUrl", label: "Profile Image URL", enabled: false },
  { key: "clientMetadata", label: "Client Metadata", enabled: false },
  { key: "clientReadOnlyMetadata", label: "Client Read-Only Metadata", enabled: false },
  { key: "serverMetadata", label: "Server Metadata", enabled: false },
];

export function ExportUsersDialog(props: {
  trigger?: React.ReactNode,
  exportOptions?: ExportOptions,
  open?: boolean,
  onOpenChange?: (open: boolean) => void,
}) {
  const { trigger, exportOptions } = props;
  const hexclaveAdminApp = useAdminApp();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = props.open ?? uncontrolledOpen;
  const setOpen = props.onOpenChange ?? setUncontrolledOpen;
  const [format, setFormat] = useState<ExportFormat>("csv");
  const [scope, setScope] = useState<ExportScope>("all");
  const [fields, setFields] = useState<ExportField[]>(DEFAULT_FIELDS);
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
    const enabledFields = fields.filter((f) => f.enabled);
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
      // Fetch all users
      const allUsers = await fetchAllUsers(
        hexclaveAdminApp,
        scope === "filtered" ? exportOptions : undefined,
        (fetched) => setProgress({ phase: "fetching", fetched }),
      );

      if (allUsers.length === 0) {
        toast({
          title: "No users to export",
          description: "There are no users matching the current filters",
          variant: "destructive",
        });
        setIsExporting(false);
        setProgress(idleExportProgress);
        return;
      }

      setProgress({ phase: "generating", fetched: allUsers.length });

      // Transform user data based on selected fields
      const transformedData = allUsers.map((user) =>
        transformUserData(user, enabledFields)
      );

      // Export based on format
      if (format === "csv") {
        exportToCsv(transformedData);
      } else {
        exportToJson(transformedData);
      }

      setProgress({ phase: "complete", fetched: allUsers.length });
      await new Promise<void>((resolve) => setTimeout(resolve, exportCompletionDisplayMs));

      toast({
        title: "Export successful",
        description: `Exported ${allUsers.length} user${allUsers.length === 1 ? "" : "s"}`,
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
      {trigger == null ? null : (
        <div onClick={() => setOpen(true)}>
          {trigger}
        </div>
      )}
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {isExporting ? (
            <ExportProgressContent progress={progress} format={format} />
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Export Users</DialogTitle>
                <DialogDescription>
                  Configure and download user data from your project
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-6 py-4">
                {/* Export Format */}
                <div className="space-y-3">
                  <Label className="text-sm font-medium">Export Format</Label>
                  <Select value={format} onValueChange={(v) => setFormat(v as ExportFormat)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="csv">CSV (Comma-separated values)</SelectItem>
                      <SelectItem value="json">JSON (JavaScript Object Notation)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Export Scope */}
                <div className="space-y-3">
                  <Label className="text-sm font-medium">Export Scope</Label>
                  <RadioGroup value={scope} onValueChange={(v) => setScope(v as ExportScope)}>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="all" id="scope-all" />
                      <Label htmlFor="scope-all" className="font-normal cursor-pointer">
                        Export all users in the project
                      </Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="filtered" id="scope-filtered" />
                      <Label htmlFor="scope-filtered" className="font-normal cursor-pointer">
                        Export only filtered/searched users
                        {exportOptions?.search && (
                          <span className="text-muted-foreground ml-1">
                            (search: &quot;{exportOptions.search}&quot;)
                          </span>
                        )}
                      </Label>
                    </div>
                  </RadioGroup>
                </div>

                {/* Field Selection */}
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
                          id={`field-${field.key}`}
                          checked={field.enabled}
                          onCheckedChange={() => toggleField(field.key)}
                        />
                        <Label
                          htmlFor={`field-${field.key}`}
                          className="text-sm font-normal cursor-pointer"
                        >
                          {field.label}
                        </Label>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Export Button */}
                <div className="flex justify-end gap-3 pt-4">
                  <Button variant="outline" onClick={() => setOpen(false)} disabled={isExporting}>
                    Cancel
                  </Button>
                  <Button onClick={() => runAsynchronouslyWithAlert(handleExport)} disabled={isExporting}>
                    <DownloadSimpleIcon className="mr-2 h-4 w-4" />
                    Export Users
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
}) {
  const { progress, format } = props;
  const fileLabel = format.toUpperCase();
  const isComplete = progress.phase === "complete";
  const title = isComplete ? "Export complete" : "Exporting users";
  const description = isComplete
    ? `Your ${fileLabel} is ready and the download should begin automatically.`
    : `Your ${fileLabel} is being prepared from matching users.`;
  const statusLabel = progress.phase === "complete"
    ? "Download ready"
    : progress.phase === "generating"
      ? `Preparing ${fileLabel}`
      : "Fetching user records";
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

async function fetchAllUsers(
  hexclaveAdminApp: ReturnType<typeof useAdminApp>,
  options?: ExportOptions,
  onProgress?: (fetched: number) => void,
): Promise<ServerUser[]> {
  const allUsers: ServerUser[] = [];
  let cursor: string | undefined = undefined;
  const limit = 100; // Fetch in batches of 100

  do {
    type ListUsersOptions = Exclude<Parameters<typeof hexclaveAdminApp.listUsers>[0], undefined>;
    const baseListUsersOptions = {
      limit,
      cursor,
      query: options?.search,
      excludedEmailDomains: options?.excludedEmailDomains,
      includeRestricted: options?.includeRestricted,
      orderBy: "signedUpAt",
      desc: true,
    } satisfies Omit<ListUsersOptions, "includeAnonymous" | "onlyAnonymous">;
    const listUsersOptions: ListUsersOptions = options?.onlyAnonymous
      ? { ...baseListUsersOptions, includeAnonymous: true, onlyAnonymous: true }
      : { ...baseListUsersOptions, includeAnonymous: options?.includeAnonymous ?? true };
    const batch = await hexclaveAdminApp.listUsers(listUsersOptions);

    allUsers.push(...batch);
    onProgress?.(allUsers.length);
    cursor = batch.nextCursor ?? undefined;
  } while (cursor);

  return allUsers;
}

function transformUserData(
  user: ServerUser,
  enabledFields: ExportField[]
): Record<string, unknown> {
  const data: Record<string, unknown> = {};

  for (const field of enabledFields) {
    switch (field.key) {
      case "id": {
        data["User ID"] = user.id;
        break;
      }
      case "displayName": {
        data["Display Name"] = user.displayName ?? "";
        break;
      }
      case "primaryEmail": {
        data["Email"] = user.primaryEmail ?? "";
        break;
      }
      case "primaryEmailVerified": {
        data["Email Verified"] = user.primaryEmailVerified ? "Yes" : "No";
        break;
      }
      case "signedUpAt": {
        data["Signed Up At"] = new Date(user.signedUpAt).toISOString();
        break;
      }
      case "lastActiveAt": {
        data["Last Active At"] = new Date(user.lastActiveAt).toISOString();
        break;
      }
      case "isAnonymous": {
        data["Is Anonymous"] = user.isAnonymous ? "Yes" : "No";
        break;
      }
      case "hasPassword": {
        data["Has Password"] = user.hasPassword ? "Yes" : "No";
        break;
      }
      case "otpAuthEnabled": {
        data["OTP Auth Enabled"] = user.otpAuthEnabled ? "Yes" : "No";
        break;
      }
      case "passkeyAuthEnabled": {
        data["Passkey Auth Enabled"] = user.passkeyAuthEnabled ? "Yes" : "No";
        break;
      }
      case "isMultiFactorRequired": {
        data["Multi-Factor Required"] = user.isMultiFactorRequired ? "Yes" : "No";
        break;
      }
      case "oauthProviders": {
        data["OAuth Providers"] = user.oauthProviders.map((p) => p.id).join(", ");
        break;
      }
      case "profileImageUrl": {
        data["Profile Image URL"] = user.profileImageUrl ?? "";
        break;
      }
      case "clientMetadata": {
        data["Client Metadata"] = JSON.stringify(user.clientMetadata ?? {});
        break;
      }
      case "clientReadOnlyMetadata": {
        data["Client Read-Only Metadata"] = JSON.stringify(user.clientReadOnlyMetadata ?? {});
        break;
      }
      case "serverMetadata": {
        data["Server Metadata"] = JSON.stringify(user.serverMetadata ?? {});
        break;
      }
    }
  }

  return data;
}

function exportToCsv(data: Record<string, unknown>[]) {
  const csvConfig = mkConfig({
    fieldSeparator: ",",
    filename: `stack-users-export-${new Date().toISOString().split("T")[0]}`,
    decimalSeparator: ".",
    useKeysAsHeaders: true,
  });

  const csv = generateCsv(csvConfig)(data as any);
  download(csvConfig)(csv);
}

function exportToJson(data: Record<string, unknown>[]) {
  const jsonString = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonString], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `stack-users-export-${new Date().toISOString().split("T")[0]}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
