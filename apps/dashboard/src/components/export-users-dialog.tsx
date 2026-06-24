"use client";

import { useAdminApp } from "@/app/(main)/(protected)/projects/[projectId]/use-admin-app";
import { ExportDataDialog, type ExportField } from "@/components/export-data-dialog";
import type { ServerUser } from "@hexclave/next";
import type { ReactNode } from "react";

export type ExportUsersOptions = {
  search?: string,
  includeRestricted: boolean,
  includeAnonymous: boolean,
  onlyAnonymous?: boolean,
  excludedEmailDomains: string[],
};

const USER_EXPORT_FIELDS: ExportField<ServerUser>[] = [
  { key: "id", label: "User ID", enabled: true, getValue: (user) => user.id },
  { key: "displayName", label: "Display Name", enabled: true, getValue: (user) => user.displayName ?? "" },
  { key: "primaryEmail", label: "Email", enabled: true, getValue: (user) => user.primaryEmail ?? "" },
  { key: "primaryEmailVerified", label: "Email Verified", enabled: true, getValue: (user) => user.primaryEmailVerified ? "Yes" : "No" },
  { key: "signedUpAt", label: "Signed Up At", enabled: true, getValue: (user) => new Date(user.signedUpAt).toISOString() },
  { key: "lastActiveAt", label: "Last Active At", enabled: true, getValue: (user) => new Date(user.lastActiveAt).toISOString() },
  { key: "isAnonymous", label: "Is Anonymous", enabled: false, getValue: (user) => user.isAnonymous ? "Yes" : "No" },
  { key: "hasPassword", label: "Has Password", enabled: false, getValue: (user) => user.hasPassword ? "Yes" : "No" },
  { key: "otpAuthEnabled", label: "OTP Auth Enabled", enabled: false, getValue: (user) => user.otpAuthEnabled ? "Yes" : "No" },
  { key: "passkeyAuthEnabled", label: "Passkey Auth Enabled", enabled: false, getValue: (user) => user.passkeyAuthEnabled ? "Yes" : "No" },
  { key: "isMultiFactorRequired", label: "Multi-Factor Required", enabled: false, getValue: (user) => user.isMultiFactorRequired ? "Yes" : "No" },
  { key: "oauthProviders", label: "OAuth Providers", enabled: false, getValue: (user) => user.oauthProviders.map((provider) => provider.id).join(", ") },
  { key: "profileImageUrl", label: "Profile Image URL", enabled: false, getValue: (user) => user.profileImageUrl ?? "" },
  { key: "clientMetadata", label: "Client Metadata", enabled: false, getValue: (user) => JSON.stringify(user.clientMetadata ?? {}) },
  { key: "clientReadOnlyMetadata", label: "Client Read-Only Metadata", enabled: false, getValue: (user) => JSON.stringify(user.clientReadOnlyMetadata ?? {}) },
  { key: "serverMetadata", label: "Server Metadata", enabled: false, getValue: (user) => JSON.stringify(user.serverMetadata ?? {}) },
];

export function ExportUsersDialog(props: {
  trigger?: ReactNode,
  exportOptions?: ExportUsersOptions,
  open?: boolean,
  onOpenChange?: (open: boolean) => void,
}) {
  const hexclaveAdminApp = useAdminApp();

  return (
    <ExportDataDialog
      trigger={props.trigger}
      open={props.open}
      onOpenChange={props.onOpenChange}
      title="Export Users"
      description="Configure and download user data from your project"
      entityName="user"
      entityNamePlural="users"
      filenamePrefix="stack-users-export"
      fields={USER_EXPORT_FIELDS}
      fetchRows={async ({ scope, onProgress }) => await fetchAllUsers(
        hexclaveAdminApp,
        scope === "filtered" ? props.exportOptions : undefined,
        onProgress,
      )}
      emptyExportTitle="No users to export"
      emptyExportDescription="There are no users matching the current filters"
      allScopeLabel="Export all users in the project"
      filteredScopeLabel={(
        <>
          Export only filtered/searched users
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

async function fetchAllUsers(
  hexclaveAdminApp: ReturnType<typeof useAdminApp>,
  options: ExportUsersOptions | undefined,
  onProgress: (fetched: number) => void,
): Promise<ServerUser[]> {
  const allUsers: ServerUser[] = [];
  let cursor: string | undefined = undefined;
  const limit = 100;

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
    onProgress(allUsers.length);
    cursor = batch.nextCursor ?? undefined;
  } while (cursor);

  return allUsers;
}
