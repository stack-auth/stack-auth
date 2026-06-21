"use client";

import { CodeBlock } from "@/components/code-block";
import { DesignAlert, DesignBadge, DesignCard } from "@/components/design-components";
import { StyledLink } from "@/components/link";
import { useRouter } from "@/components/router";
import { Spinner, Typography } from "@/components/ui";
import { CheckCircleIcon, WarningIcon } from "@phosphor-icons/react";
import { AdminEmailOutbox } from "@hexclave/next";
import {
  DataGrid,
  useDataGridUrlState,
  useDataSource,
  type DataGridColumnDef,
  type DataGridDataSource,
} from "@hexclave/dashboard-ui-components";
import { useCallback, useMemo } from "react";
import { AppEnabledGuard } from "../app-enabled-guard";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";
import { STATUS_LABELS, getStatusBadgeColor } from "../email-sent/email-status-utils";

const QUICKSTART_SNIPPET = `// Server-side only — requires a secret server API key.
import { hexclaveServerApp } from "@/stack/server";

await hexclaveServerApp.sendEmail({
  userIds: ["<user-id>"],
  subject: "Welcome aboard!",
  html: "<h1>Hello from the Email API</h1>",
  // Or reuse a dashboard template/theme instead of raw html:
  // templateId: "<template-id>",
  // themeId: "<theme-id>",
});`;

function DeliveryMetric({ label, value }: { label: string, value: number }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-2xl font-semibold tracking-tight text-foreground">{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

function RequirementsCard() {
  const hexclaveAdminApp = useAdminApp();
  const project = hexclaveAdminApp.useProject();
  const emailConfig = project.useConfig().emails.server;

  // The Email API can only send through a project-owned email server. The shared
  // development server is rate-limited to dashboard test sends and rejects
  // programmatic SDK sends, so surface that as a blocking requirement.
  const canSendViaApi = !emailConfig.isShared;

  return (
    <DesignCard glassmorphic gradient="default" contentClassName="p-5">
      <div className="flex items-start gap-3">
        {canSendViaApi
          ? <CheckCircleIcon className="h-5 w-5 shrink-0 text-emerald-500" weight="fill" />
          : <WarningIcon className="h-5 w-5 shrink-0 text-amber-500" weight="fill" />}
        <div className="flex flex-col gap-1">
          <Typography className="font-medium">
            {canSendViaApi ? "Your project can send emails via the API" : "A custom email server is required"}
          </Typography>
          <Typography variant="secondary" className="text-sm">
            {canSendViaApi
              ? "Emails sent through the SDK are delivered from your configured email server."
              : <>The Email API is unavailable while using the shared development server. Configure a custom SMTP, Resend, or managed server in <StyledLink href="email-settings">Email Settings</StyledLink>.</>}
          </Typography>
        </div>
      </div>
    </DesignCard>
  );
}

function DeliveryMetricsCard() {
  const hexclaveAdminApp = useAdminApp();
  const deliveryInfo = hexclaveAdminApp.useEmailDeliveryStats();

  return (
    <DesignCard glassmorphic gradient="default" contentClassName="p-5">
      <div className="flex flex-col gap-4">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Delivery (last 24h / 7d)
        </span>
        <div className="grid grid-cols-3 gap-4">
          <DeliveryMetric label="Sent (24h)" value={deliveryInfo.stats.day.sent} />
          <DeliveryMetric label="Bounced (24h)" value={deliveryInfo.stats.day.bounced} />
          <DeliveryMetric label="Spam (24h)" value={deliveryInfo.stats.day.marked_as_spam} />
          <DeliveryMetric label="Sent (7d)" value={deliveryInfo.stats.week.sent} />
          <DeliveryMetric label="Bounced (7d)" value={deliveryInfo.stats.week.bounced} />
          <DeliveryMetric label="Spam (7d)" value={deliveryInfo.stats.week.marked_as_spam} />
        </div>
      </div>
    </DesignCard>
  );
}

function getRecipientDisplay(email: AdminEmailOutbox): string {
  const to = email.to;
  if (to.type === "user-primary-email") {
    return `User: ${to.userId.slice(0, 8)}...`;
  } else if (to.type === "user-custom-emails") {
    return to.emails.length > 0 ? to.emails[0] : `User: ${to.userId.slice(0, 8)}...`;
  } else {
    return to.emails.length > 0 ? to.emails[0] : "No recipients";
  }
}

const recentSendsColumns: DataGridColumnDef<AdminEmailOutbox>[] = [
  {
    id: "recipient",
    header: "Recipient",
    width: 180,
    minWidth: 96,
    type: "string",
    accessor: (row) => getRecipientDisplay(row),
  },
  {
    id: "scheduledAt",
    header: "Time",
    width: 160,
    minWidth: 100,
    type: "dateTime",
    accessor: (row) => row.scheduledAt,
  },
  {
    id: "status",
    header: "Status",
    width: 120,
    minWidth: 108,
    renderCell: ({ row }) => (
      <DesignBadge label={STATUS_LABELS[row.status]} color={getStatusBadgeColor(row.status)} size="sm" />
    ),
  },
];

const RECENT_SENDS_PAGE_SIZE = 25;

function RecentSendsCard() {
  const hexclaveAdminApp = useAdminApp();
  const router = useRouter();

  const [gridState, setGridState] = useDataGridUrlState(recentSendsColumns, {
    paramPrefix: "apisends",
    initial: { sorting: [{ columnId: "scheduledAt", direction: "desc" }] },
  });

  const dataSource = useMemo<DataGridDataSource<AdminEmailOutbox>>(
    () => async function* (params) {
      const cursor = typeof params.cursor === "string" ? params.cursor : undefined;
      const result = await hexclaveAdminApp.listOutboxEmails({
        limit: RECENT_SENDS_PAGE_SIZE,
        cursor,
      });
      yield {
        rows: result.items,
        hasMore: result.nextCursor != null,
        nextCursor: result.nextCursor ?? undefined,
      };
    },
    [hexclaveAdminApp],
  );

  const getRowId = useCallback((row: AdminEmailOutbox) => row.id, []);

  const gridData = useDataSource({
    dataSource,
    columns: recentSendsColumns,
    getRowId,
    sorting: gridState.sorting,
    quickSearch: gridState.quickSearch,
    pagination: gridState.pagination,
    paginationMode: "infinite",
  });

  return (
    <DesignCard glassmorphic gradient="default" contentClassName="p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2 px-1">
        <span className="text-xs font-semibold uppercase tracking-wider text-foreground">
          Recent sends
        </span>
        <StyledLink href="email-sent" className="text-xs">View full delivery log</StyledLink>
      </div>
      {gridData.isLoading ? (
        <div className="flex items-center justify-center gap-2 py-8">
          <Spinner size={16} />
          <Typography variant="secondary">Loading sends...</Typography>
        </div>
      ) : (
        <DataGrid
          className="min-w-0"
          columns={recentSendsColumns}
          rows={gridData.rows}
          getRowId={getRowId}
          totalRowCount={gridData.totalRowCount}
          isLoading={gridData.isLoading}
          isRefetching={gridData.isRefetching}
          state={gridState}
          onChange={setGridState}
          paginationMode="infinite"
          hasMore={gridData.hasMore}
          isLoadingMore={gridData.isLoadingMore}
          onLoadMore={gridData.loadMore}
          fillHeight={false}
          footer={false}
          onRowClick={(row) => router.push(`email-viewer/${row.id}`)}
        />
      )}
    </DesignCard>
  );
}

export default function PageClient() {
  return (
    <AppEnabledGuard appId="email-api">
      <PageLayout
        title="Email API"
        description="Send transactional emails programmatically from your server code."
      >
        <div className="flex flex-col gap-6 min-w-0">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <RequirementsCard />
            <DeliveryMetricsCard />
          </div>

          <DesignCard glassmorphic gradient="default" contentClassName="p-5">
            <div className="flex flex-col gap-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-foreground">
                Quickstart
              </span>
              <DesignAlert
                variant="warning"
                description={<>
                  Sending requires a <StyledLink href="api-keys-app">secret server API key</StyledLink>.
                  Never call the Email API from client code.
                </>}
              />
              <CodeBlock language="tsx" content={QUICKSTART_SNIPPET} title="server.ts" icon="code" />
            </div>
          </DesignCard>

          <RecentSendsCard />
        </div>
      </PageLayout>
    </AppEnabledGuard>
  );
}
