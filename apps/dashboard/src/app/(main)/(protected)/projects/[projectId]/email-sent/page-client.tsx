"use client";

import { SettingCard } from "@/components/settings";
import { DataTable, Switch, Typography } from "@/components/ui";
import { AdminSentEmail } from "@stackframe/stack";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { ColumnDef } from "@tanstack/react-table";
import { useEffect, useState } from "react";
import { AppEnabledGuard } from "../app-enabled-guard";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";
import { DomainReputationCard } from "./domain-reputation-card";

type ViewMode = "grouped" | "list";

function ViewModeToggle({
  mode,
  onModeChange,
}: {
  mode: ViewMode,
  onModeChange: (mode: ViewMode) => void,
}) {
  const isListMode = mode === "list";

  return (
    <div className="flex items-center gap-2">
      <Typography className="text-sm">Group by template/draft</Typography>
      <Switch
        checked={isListMode}
        onCheckedChange={(checked) => onModeChange(checked ? "list" : "grouped")}
      />
      <Typography className="text-sm">List all</Typography>
    </div>
  );
}

const emailTableColumns: ColumnDef<AdminSentEmail>[] = [
  { accessorKey: "recipient", header: "Recipient" },
  { accessorKey: "subject", header: "Subject" },
  {
    accessorKey: "sentAt",
    header: "Sent At",
    cell: ({ row }) => {
      const date = row.original.sentAt;
      return date.toLocaleDateString() + " " + date.toLocaleTimeString();
    },
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => {
      return row.original.error ? (
        <div className="text-red-500">Failed</div>
      ) : (
        <div className="text-green-500">Sent</div>
      );
    },
  },
];

function EmailSendDataTable() {
  const stackAdminApp = useAdminApp();
  const [emailLogs, setEmailLogs] = useState<AdminSentEmail[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    runAsynchronously(async () => {
      setLoading(true);
      try {
        const emails = await stackAdminApp.listSentEmails();
        setEmailLogs(emails);
      } finally {
        setLoading(false);
      }
    });
  }, [stackAdminApp]);

  if (loading) {
    return (
      <div className="flex justify-center py-4">
        <Typography>Loading email logs...</Typography>
      </div>
    );
  }

  return (
    <DataTable
      data={emailLogs}
      defaultColumnFilters={[]}
      columns={emailTableColumns}
      defaultSorting={[{ id: "sentAt", desc: true }]}
    />
  );
}

export default function PageClient() {
  const [viewMode, setViewMode] = useState<ViewMode>("list");

  return (
    <AppEnabledGuard appId="emails">
      <PageLayout
        title="Sent"
        description="View email logs and domain reputation"
      >
        <div className="flex gap-6">
          {/* Left side: Email Log with toggle above right corner */}
          <div className="flex-1 flex flex-col gap-4">
            <div className="flex justify-end">
              <ViewModeToggle mode={viewMode} onModeChange={setViewMode} />
            </div>
            <SettingCard title="Email Log" description="Manage email sending history">
              <EmailSendDataTable />
            </SettingCard>
          </div>

          {/* Right side: Domain Reputation */}
          <div className="flex-shrink-0">
            <DomainReputationCard />
          </div>
        </div>
      </PageLayout>
    </AppEnabledGuard>
  );
}
