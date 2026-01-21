"use client";

import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { DownloadSimpleIcon } from "@phosphor-icons/react";
import type { ServerUser } from "@stackframe/stack";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
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
import { useState } from "react";

type ExportFormat = "csv" | "json";
type ExportScope = "all" | "filtered";

type ExportField = {
  key: string,
  label: string,
  enabled: boolean,
};

type ExportOptions = {
  search?: string,
  includeAnonymous: boolean,
};

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
  trigger: React.ReactNode,
  exportOptions?: ExportOptions,
}) {
  const { trigger, exportOptions } = props;
  const stackAdminApp = useAdminApp();
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<ExportFormat>("csv");
  const [scope, setScope] = useState<ExportScope>("all");
  const [fields, setFields] = useState<ExportField[]>(DEFAULT_FIELDS);
  const [isExporting, setIsExporting] = useState(false);

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
    try {
      // Fetch all users
      const allUsers = await fetchAllUsers(
        stackAdminApp,
        scope === "filtered" ? exportOptions : undefined
      );

      if (allUsers.length === 0) {
        toast({
          title: "No users to export",
          description: "There are no users matching the current filters",
          variant: "destructive",
        });
        setIsExporting(false);
        return;
      }

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
    }
  };

  return (
    <>
      <div onClick={() => setOpen(true)}>
        {trigger}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
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
                {isExporting ? "Exporting..." : "Export Users"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

async function fetchAllUsers(
  stackAdminApp: ReturnType<typeof useAdminApp>,
  options?: ExportOptions
): Promise<ServerUser[]> {
  const allUsers: ServerUser[] = [];
  let cursor: string | undefined = undefined;
  const limit = 100; // Fetch in batches of 100

  do {
    const batch = await stackAdminApp.listUsers({
      limit,
      cursor,
      query: options?.search,
      includeAnonymous: options?.includeAnonymous ?? true,
      orderBy: "signedUpAt",
      desc: true,
    });

    allUsers.push(...batch);
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
