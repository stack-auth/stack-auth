"use client";
import { DesignAlert, DesignButton, DesignCard, DesignDataTable } from "@/components/design-components";
import { DesignMenu } from "@/components/design-components/menu";
import { EnvKeys } from "@/components/env-keys";
import { SmartFormDialog } from "@/components/form-dialog";
import { SelectField } from "@/components/form-fields";
import { SettingSwitch } from "@/components/settings";
import {
  ActionCell,
  ActionDialog,
  BadgeCell,
  DataTableColumnHeader,
  DataTableFacetedFilter,
  SearchToolbarItem,
  Switch,
  TextCell,
  Typography,
  standardFilterFn,
} from "@/components/ui";
import { GlobeHemisphereWestIcon, KeyIcon, ShieldCheckIcon } from "@phosphor-icons/react";
import { InternalApiKey, InternalApiKeyFirstView } from "@stackframe/stack";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { stringCompare } from "@stackframe/stack-shared/dist/utils/strings";
import { generateUuid } from "@stackframe/stack-shared/dist/utils/uuids";
import { ColumnDef, Row, Table } from "@tanstack/react-table";
import { useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import * as yup from "yup";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";
import { useUpdateConfig } from "@/lib/config-update";
import { OidcPolicyDialog } from "./oidc-policy-dialog";
import {
  PolicyDraft,
  TrustPolicy,
  emptyDraft,
  policyToDraft,
} from "./oidc-policy-form";

type KeyRow = {
  kind: "key",
  id: string,
  name: string,
  status: "valid" | "expired" | "revoked",
  apiKey: InternalApiKey,
};

type PolicyRow = {
  kind: "policy",
  id: string,
  name: string,
  status: "enabled" | "disabled",
  policy: TrustPolicy,
};

type UnifiedRow = KeyRow | PolicyRow;

const TYPE_LABEL: Record<UnifiedRow["kind"], string> = {
  key: "Project Key",
  policy: "Trust Policy",
};

export default function PageClient() {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const config = project.useConfig();
  const updateConfig = useUpdateConfig();
  const requirePublishableClientKey = config.project.requirePublishableClientKey;
  const apiKeySets = stackAdminApp.useInternalApiKeys();
  const params = useSearchParams();
  const create = params.get("create") === "true";

  const [isNewApiKeyDialogOpen, setIsNewApiKeyDialogOpen] = useState(create);
  const [returnedApiKey, setReturnedApiKey] = useState<InternalApiKeyFirstView | null>(null);
  const [policyDialog, setPolicyDialog] = useState<
    | { mode: "create" }
    | { mode: "edit", draft: PolicyDraft }
    | null
  >(null);

  const policies = useMemo(
    () => Object.entries(config.oidcFederation.trustPolicies),
    [config.oidcFederation.trustPolicies],
  );

  const rows: UnifiedRow[] = useMemo(() => {
    const keyRows: KeyRow[] = apiKeySets.map((apiKey) => {
      const status = ({ valid: "valid", "manually-revoked": "revoked", expired: "expired" } as const)[apiKey.whyInvalid() ?? "valid"];
      return {
        kind: "key",
        id: apiKey.id,
        name: apiKey.description || "(no description)",
        status,
        apiKey,
      };
    });
    const policyRows: PolicyRow[] = policies.map(([id, policy]) => ({
      kind: "policy",
      id,
      name: policy.displayName || "(unnamed policy)",
      status: policy.enabled ? "enabled" : "disabled",
      policy,
    }));
    return [
      ...keyRows.sort((a, b) => (a.status === b.status ? a.apiKey.createdAt < b.apiKey.createdAt ? 1 : -1 : a.status === "valid" ? -1 : 1)),
      ...policyRows.sort((a, b) => (a.status === b.status ? stringCompare(a.name, b.name) : a.status === "enabled" ? -1 : 1)),
    ];
  }, [apiKeySets, policies]);

  const savePolicy = useCallback(async (policy: TrustPolicy, draft: PolicyDraft, isCreate: boolean) => {
    const id = isCreate ? generateUuid() : draft.id;
    if (!id) throw new StackAssertionError("Trust policy ID missing on save");
    await updateConfig({
      adminApp: stackAdminApp,
      configUpdate: { [`oidcFederation.trustPolicies.${id}`]: policy },
      pushable: false,
    });
  }, [stackAdminApp, updateConfig]);
  const deletePolicy = useCallback(async (id: string) => {
    await updateConfig({
      adminApp: stackAdminApp,
      configUpdate: { [`oidcFederation.trustPolicies.${id}`]: null },
      pushable: false,
    });
  }, [stackAdminApp, updateConfig]);
  const togglePolicy = useCallback(async (id: string, enabled: boolean) => {
    await updateConfig({
      adminApp: stackAdminApp,
      configUpdate: { [`oidcFederation.trustPolicies.${id}.enabled`]: enabled },
      pushable: false,
    });
  }, [stackAdminApp, updateConfig]);

  const columns = useMemo<ColumnDef<UnifiedRow>[]>(() => [
    {
      id: "kind",
      accessorKey: "kind",
      header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Type" />,
      cell: ({ row }) => <TypeCell kind={row.original.kind} />,
      filterFn: standardFilterFn,
      size: 160,
    },
    {
      id: "name",
      accessorKey: "name",
      header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Name" />,
      cell: ({ row }) => <TextCell size={280}>{row.original.name}</TextCell>,
    },
    {
      id: "details",
      header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Details" />,
      enableSorting: false,
      cell: ({ row }) => (
        row.original.kind === "key"
          ? <KeyDetails row={row.original} showPublishable={requirePublishableClientKey} />
          : <PolicyDetails row={row.original} />
      ),
    },
    {
      id: "status",
      accessorKey: "status",
      header: ({ column }) => <DataTableColumnHeader column={column} columnTitle="Status" />,
      cell: ({ row }) => <BadgeCell badges={[row.original.status]} />,
      filterFn: standardFilterFn,
      size: 110,
    },
    {
      id: "actions",
      enableSorting: false,
      cell: ({ row }) => <RowActions
        row={row}
        onEditPolicy={(p) => setPolicyDialog({ mode: "edit", draft: policyToDraft(p.id, p.policy) })}
        onTogglePolicy={(id, enabled) => runAsynchronouslyWithAlert(togglePolicy(id, enabled))}
        onDeletePolicy={(id) => runAsynchronouslyWithAlert(deletePolicy(id))}
      />,
    },
  ], [requirePublishableClientKey, deletePolicy, togglePolicy]);

  return (
    <PageLayout
      title="Project Keys"
      description="Static project keys and OIDC federation trust policies. Both authorize server-side access to this project."
      actions={
        <DesignMenu
          variant="actions"
          triggerLabel="Add"
          align="end"
          withIcons
          items={[
            { id: "key", label: "Create Project Key", icon: <KeyIcon className="h-4 w-4" />, onClick: () => setIsNewApiKeyDialogOpen(true) },
            { id: "policy", label: "Add Trust Policy", icon: <ShieldCheckIcon className="h-4 w-4" />, onClick: () => setPolicyDialog({ mode: "create" }) },
          ]}
        />
      }
    >
      <DesignCard glassmorphic>
        <DesignDataTable
          data={rows}
          columns={columns}
          toolbarRender={(table) => <UnifiedToolbar table={table} />}
          defaultColumnFilters={[{ id: "status", value: ["valid", "enabled"] }]}
          defaultSorting={[]}
        />
      </DesignCard>

      <SettingSwitch
        label="[Advanced] Require publishable client keys"
        hint="When enabled, client requests must include a publishable client key."
        checked={requirePublishableClientKey}
        onCheckedChange={async (checked) => {
          await project.update({ requirePublishableClientKey: checked });
        }}
      />

      <CreateKeyDialog
        open={isNewApiKeyDialogOpen}
        onOpenChange={setIsNewApiKeyDialogOpen}
        onKeyCreated={setReturnedApiKey}
        requirePublishableClientKey={requirePublishableClientKey}
      />
      <ShowKeyDialog apiKey={returnedApiKey || undefined} onClose={() => setReturnedApiKey(null)} />

      {policyDialog && (
        <OidcPolicyDialog
          open
          mode={policyDialog.mode}
          initial={policyDialog.mode === "edit" ? policyDialog.draft : emptyDraft()}
          projectId={project.id}
          adminApp={stackAdminApp}
          onClose={() => setPolicyDialog(null)}
          onSave={async (policy, draft) => {
            await savePolicy(policy, draft, policyDialog.mode === "create");
            setPolicyDialog(null);
          }}
        />
      )}
    </PageLayout>
  );
}

// ── Toolbar ───────────────────────────────────────────────────────────────

function UnifiedToolbar<TData>({ table }: { table: Table<TData> }) {
  return (
    <>
      <SearchToolbarItem table={table} placeholder="Search keys & policies" />
      <DataTableFacetedFilter
        column={table.getColumn("kind")}
        title="Type"
        options={[
          { value: "key", label: "Project Key" },
          { value: "policy", label: "Trust Policy" },
        ]}
      />
      <DataTableFacetedFilter
        column={table.getColumn("status")}
        title="Status"
        options={[
          { value: "valid", label: "Valid" },
          { value: "expired", label: "Expired" },
          { value: "revoked", label: "Revoked" },
          { value: "enabled", label: "Enabled" },
          { value: "disabled", label: "Disabled" },
        ]}
      />
    </>
  );
}

// ── Cells ─────────────────────────────────────────────────────────────────

function TypeCell({ kind }: { kind: UnifiedRow["kind"] }) {
  const Icon = kind === "key" ? KeyIcon : ShieldCheckIcon;
  return (
    <div className="inline-flex items-center gap-2">
      <div className="h-7 w-7 shrink-0 rounded-lg bg-foreground/[0.04] ring-1 ring-foreground/[0.06] inline-flex items-center justify-center">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
      <Typography className="text-sm text-foreground">{TYPE_LABEL[kind]}</Typography>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-foreground/[0.04] ring-1 ring-foreground/[0.06] px-1.5 py-0.5 text-[11px] text-muted-foreground max-w-[18rem] truncate">
      {children}
    </span>
  );
}

function KeyDetails({ row, showPublishable }: { row: KeyRow, showPublishable: boolean }) {
  const client = row.apiKey.publishableClientKey?.lastFour;
  const server = row.apiKey.secretServerKey?.lastFour;
  const expires = row.apiKey.expiresAt;
  const neverExpires = new Date(new Date().setFullYear(new Date().getFullYear() + 50)) < expires;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {showPublishable && client && <Chip>client ••••{client}</Chip>}
      {server && <Chip>server ••••{server}</Chip>}
      <Chip>{neverExpires ? "never expires" : `expires ${expires.toLocaleDateString()}`}</Chip>
    </div>
  );
}

function PolicyDetails({ row }: { row: PolicyRow }) {
  const audienceList = Object.values(row.policy.audiences ?? {}).filter((v): v is string => typeof v === "string");
  const equalsCount = Object.keys(row.policy.claimConditions.stringEquals ?? {}).length;
  const likeCount = Object.keys(row.policy.claimConditions.stringLike ?? {}).length;
  const conditionCount = equalsCount + likeCount;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Chip>
        <GlobeHemisphereWestIcon className="h-3 w-3" />
        <span className="truncate">{row.policy.issuerUrl || "(no issuer)"}</span>
      </Chip>
      <Chip>{audienceList.length} {audienceList.length === 1 ? "audience" : "audiences"}</Chip>
      <Chip>{conditionCount} {conditionCount === 1 ? "condition" : "conditions"}</Chip>
      {typeof row.policy.tokenTtlSeconds === "number" && <Chip>{row.policy.tokenTtlSeconds}s TTL</Chip>}
    </div>
  );
}

function RowActions(props: {
  row: Row<UnifiedRow>,
  onEditPolicy: (p: PolicyRow) => void,
  onTogglePolicy: (id: string, enabled: boolean) => void,
  onDeletePolicy: (id: string) => void,
}) {
  const [isRevokeOpen, setIsRevokeOpen] = useState(false);
  const r = props.row.original;
  if (r.kind === "key") {
    return (
      <>
        <RevokeKeyDialog apiKey={r.apiKey} open={isRevokeOpen} onOpenChange={setIsRevokeOpen} />
        <ActionCell
          invisible={r.status !== "valid"}
          items={[{ item: "Revoke", danger: true, onClick: () => setIsRevokeOpen(true) }]}
        />
      </>
    );
  }
  return (
    <div className="flex items-center gap-2 justify-end">
      <Switch
        checked={r.policy.enabled}
        onCheckedChange={(checked) => props.onTogglePolicy(r.id, checked)}
        aria-label={r.policy.enabled ? "Disable policy" : "Enable policy"}
      />
      <ActionCell
        items={[
          { item: "Edit", onClick: () => props.onEditPolicy(r) },
          { item: "Delete", danger: true, onClick: () => props.onDeletePolicy(r.id) },
        ]}
      />
    </div>
  );
}

// ── API key dialogs (preserved) ───────────────────────────────────────────

const neverInMs = 1000 * 60 * 60 * 24 * 365 * 200;
const expiresInOptions = {
  [1000 * 60 * 60 * 24 * 1]: "1 day",
  [1000 * 60 * 60 * 24 * 7]: "7 days",
  [1000 * 60 * 60 * 24 * 30]: "30 days",
  [1000 * 60 * 60 * 24 * 90]: "90 days",
  [1000 * 60 * 60 * 24 * 365]: "1 year",
  [neverInMs]: "Never",
} as const;

function CreateKeyDialog(props: {
  open: boolean,
  onOpenChange: (open: boolean) => void,
  onKeyCreated?: (key: InternalApiKeyFirstView) => void,
  requirePublishableClientKey: boolean,
}) {
  const stackAdminApp = useAdminApp();
  const params = useSearchParams();
  const defaultDescription = params.get("description");

  const formSchema = yup.object({
    description: yup.string().defined().label("Description").default(defaultDescription || ""),
    expiresIn: yup.string().default(neverInMs.toString()).label("Expires in").meta({
      stackFormFieldRender: (props) => (
        <SelectField {...props} options={Object.entries(expiresInOptions).map(([value, label]) => ({ value, label }))} />
      ),
    }),
  });

  return <SmartFormDialog
    open={props.open}
    onOpenChange={props.onOpenChange}
    title="Create Project Key"
    formSchema={formSchema}
    okButton={{ label: "Create" }}
    onSubmit={async (values) => {
      const expiresIn = parseInt(values.expiresIn);
      const newKey = await stackAdminApp.createInternalApiKey({
        hasPublishableClientKey: props.requirePublishableClientKey,
        hasSecretServerKey: true,
        hasSuperSecretAdminKey: false,
        expiresAt: new Date(Date.now() + expiresIn),
        description: values.description,
      });
      props.onKeyCreated?.(newKey);
    }}
    cancelButton
  />;
}

function ShowKeyDialog(props: { apiKey?: InternalApiKeyFirstView, onClose?: () => void }) {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  if (!props.apiKey) return null;
  return (
    <ActionDialog
      open={!!props.apiKey}
      title="Project Key"
      okButton={{ label: "Close" }}
      onClose={props.onClose}
      preventClose
      confirmText="I understand that I will not be able to view these keys again."
    >
      <div className="flex flex-col gap-4">
        <DesignAlert
          variant="warning"
          description={<>
            Here are your project keys.{" "}
            <span className="font-bold text-foreground/90">Copy them to a safe place. You will not be able to view them again.</span>
          </>}
        />
        <EnvKeys projectId={project.id} publishableClientKey={props.apiKey.publishableClientKey} secretServerKey={props.apiKey.secretServerKey} />
      </div>
    </ActionDialog>
  );
}

function RevokeKeyDialog(props: { apiKey: KeyRow["apiKey"], open: boolean, onOpenChange: (open: boolean) => void }) {
  const clientKeyText = props.apiKey.publishableClientKey?.lastFour ? `client key *****${props.apiKey.publishableClientKey.lastFour}` : null;
  const serverKeyText = props.apiKey.secretServerKey?.lastFour ? `server key *****${props.apiKey.secretServerKey.lastFour}` : null;
  const keysText = [clientKeyText, serverKeyText].filter(Boolean).join(" and ");
  const confirmText = keysText ? `Are you sure you want to revoke ${keysText}?` : "Are you sure you want to revoke this API key?";
  return (
    <ActionDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title="Revoke API Key"
      danger
      cancelButton
      okButton={{ label: "Revoke Key", onClick: async () => { await props.apiKey.revoke(); } }}
      confirmText="I understand this will unlink all the apps using this API key"
    >
      {confirmText}
    </ActionDialog>
  );
}
