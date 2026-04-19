'use client';
import { InternalApiKey } from '@stackframe/stack';
import { ActionCell, ActionDialog, Badge, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui";
import {
  createDefaultDataGridState,
  DataGrid,
  useDataSource,
  type DataGridColumnDef,
} from "@stackframe/dashboard-ui-components";
import { useMemo, useState } from "react";

type ApiKeyStatus = 'valid' | 'expired' | 'revoked';
type ApiKeyStatusFilter = 'all' | ApiKeyStatus;

type ExtendedInternalApiKey = InternalApiKey & {
  status: ApiKeyStatus,
};

/** Matches previous `DateCell` + `ignoreAfterYears={50}` behaviour. */
function formatApiKeyDateDisplay(date: Date) {
  const ignoreAfterYears = 50;
  const ignore = new Date(new Date().setFullYear(new Date().getFullYear() + ignoreAfterYears)) < date;
  const timeString = date.toLocaleTimeString([], { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return ignore ? 'Never' : timeString;
}

function RevokeDialog(props: {
  apiKey: ExtendedInternalApiKey,
  open: boolean,
  onOpenChange: (open: boolean) => void,
}) {
  const clientKeyText = props.apiKey.publishableClientKey?.lastFour
    ? `client key *****${props.apiKey.publishableClientKey.lastFour}`
    : null;
  const serverKeyText = props.apiKey.secretServerKey?.lastFour
    ? `server key *****${props.apiKey.secretServerKey.lastFour}`
    : null;
  const keysText = [clientKeyText, serverKeyText].filter(Boolean).join(" and ");
  const confirmText = keysText
    ? `Are you sure you want to revoke ${keysText}?`
    : "Are you sure you want to revoke this API key?";

  return <ActionDialog
    open={props.open}
    onOpenChange={props.onOpenChange}
    title="Revoke API Key"
    danger
    cancelButton
    okButton={{ label: "Revoke Key", onClick: async () => { await props.apiKey.revoke(); } }}
    confirmText="I understand this will unlink all the apps using this API key"
  >
    {confirmText}
  </ActionDialog>;
}

function Actions({ apiKey }: { apiKey: ExtendedInternalApiKey }) {
  const [isRevokeModalOpen, setIsRevokeModalOpen] = useState(false);
  return (
    <>
      <RevokeDialog apiKey={apiKey} open={isRevokeModalOpen} onOpenChange={setIsRevokeModalOpen} />
      <ActionCell
        invisible={apiKey.status !== 'valid'}
        items={[{
          item: "Revoke",
          danger: true,
          onClick: () => setIsRevokeModalOpen(true),
        }]}
      />
    </>
  );
}

const getColumns = (showPublishableClientKey: boolean): DataGridColumnDef<ExtendedInternalApiKey>[] => {
  const baseColumns: DataGridColumnDef<ExtendedInternalApiKey>[] = [
    {
      id: "description",
      header: "Description",
      accessor: "description",
      type: "string",
      width: 300,
      flex: 1,
      renderCell: ({ row }) => (
        <span className="block truncate" title={row.description}>{row.description}</span>
      ),
    },
    {
      id: "status",
      header: "Status",
      accessor: "status",
      type: "string",
      width: 120,
      renderCell: ({ row }) => (
        <Badge variant="secondary">{row.status}</Badge>
      ),
    },
  ];

  const clientKeyColumn: DataGridColumnDef<ExtendedInternalApiKey> = {
    id: "clientKey",
    header: "Client Key",
    accessor: (row) => row.publishableClientKey?.lastFour,
    type: "string",
    sortable: false,
    width: 160,
    renderCell: ({ row }) => (
      <span className="truncate">
        {row.publishableClientKey?.lastFour ? `*******${row.publishableClientKey.lastFour}` : "—"}
      </span>
    ),
  };

  const serverKeyColumn: DataGridColumnDef<ExtendedInternalApiKey> = {
    id: "serverKey",
    header: "Server Key",
    accessor: (row) => row.secretServerKey?.lastFour,
    type: "string",
    sortable: false,
    width: 160,
    renderCell: ({ row }) => (
      <span className="truncate">
        {row.secretServerKey?.lastFour ? `*******${row.secretServerKey.lastFour}` : "—"}
      </span>
    ),
  };

  const tailColumns: DataGridColumnDef<ExtendedInternalApiKey>[] = [
    {
      id: "expiresAt",
      header: "Expires At",
      accessor: "expiresAt",
      type: "dateTime",
      width: 180,
      renderCell: ({ row }) => (
        <span className="truncate">{formatApiKeyDateDisplay(row.expiresAt)}</span>
      ),
    },
    {
      id: "createdAt",
      header: "Created At",
      accessor: "createdAt",
      type: "dateTime",
      width: 180,
      renderCell: ({ row }) => (
        <span className="truncate">{formatApiKeyDateDisplay(row.createdAt)}</span>
      ),
    },
    {
      id: "actions",
      header: "",
      sortable: false,
      hideable: false,
      resizable: false,
      width: 50,
      minWidth: 50,
      maxWidth: 50,
      renderCell: ({ row }) => <Actions apiKey={row} />,
    },
  ];

  return showPublishableClientKey
    ? [...baseColumns, clientKeyColumn, serverKeyColumn, ...tailColumns]
    : [...baseColumns, serverKeyColumn, ...tailColumns];
};

export function InternalApiKeyTable(props: { apiKeys: InternalApiKey[], showPublishableClientKey?: boolean }) {
  const showPublishableClientKey = props.showPublishableClientKey ?? true;
  const columns = useMemo(
    () => getColumns(showPublishableClientKey),
    [showPublishableClientKey],
  );

  // Grid state is initialized lazily on first mount; DataGrid tolerates columns
  // whose ids vanish (clientKey toggle) so we do NOT reinit state when columns
  // change — that would wipe user-adjusted widths/sort/search.
  const [gridState, setGridState] = useState(() => createDefaultDataGridState(columns));

  // Default to "valid" so the page looks the same as before the DataGrid
  // migration (the old faceted filter defaulted to ['valid']).
  const [statusFilter, setStatusFilter] = useState<ApiKeyStatusFilter>("valid");

  const extendedApiKeys = useMemo(() => {
    const keys = props.apiKeys.map((apiKey) => ({
      ...apiKey,
      status: ({ 'valid': 'valid', 'manually-revoked': 'revoked', 'expired': 'expired' } as const)[apiKey.whyInvalid() || 'valid'],
    } satisfies ExtendedInternalApiKey));
    // first sort based on status, then by createdAt
    return keys.sort((a, b) => {
      if (a.status === b.status) {
        return a.createdAt < b.createdAt ? 1 : -1;
      }
      return a.status === 'valid' ? -1 : 1;
    });
  }, [props.apiKeys]);

  const filteredApiKeys = useMemo(
    () => statusFilter === "all" ? extendedApiKeys : extendedApiKeys.filter((k) => k.status === statusFilter),
    [extendedApiKeys, statusFilter],
  );

  const gridData = useDataSource({
    data: filteredApiKeys,
    columns,
    getRowId: (row) => row.id,
    sorting: gridState.sorting,
    quickSearch: gridState.quickSearch,
    pagination: gridState.pagination,
    paginationMode: "client",
  });

  return (
    <DataGrid
      columns={columns}
      rows={gridData.rows}
      getRowId={(row) => row.id}
      totalRowCount={gridData.totalRowCount}
      isLoading={gridData.isLoading}
      state={gridState}
      onChange={setGridState}
      toolbarExtra={
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as ApiKeyStatusFilter)}>
          <SelectTrigger className="h-8 w-[140px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="valid">Valid</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
            <SelectItem value="revoked">Revoked</SelectItem>
          </SelectContent>
        </Select>
      }
      footer={false}
    />
  );
}
