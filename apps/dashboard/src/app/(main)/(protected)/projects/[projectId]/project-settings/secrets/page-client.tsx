"use client";

// Write-only secret values for deployments: `secret()` env vars in the config
// file's `services` export are filled from these at deploy time. Values can be
// set, overwritten, and deleted here, but never read back — the API doesn't
// return them, so this page only shows which keys exist (and which are still
// missing for the currently-synced services).

import { DesignAlert, DesignBadge } from "@/components/design-components";
import { FormDialog } from "@/components/form-dialog";
import { InputField } from "@/components/form-fields";
import { SettingCard } from "@/components/settings";
import { ActionCell, ActionDialog, Button, Spinner, Typography } from "@/components/ui";
import { DEPLOYMENT_SECRET_KEY_REGEX } from "@hexclave/shared/dist/deployments";
import { runAsynchronouslyWithAlert } from "@hexclave/shared/dist/utils/promises";
import { yupString } from "@hexclave/shared/dist/schema-fields";
import { stringCompare } from "@hexclave/shared/dist/utils/strings";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as yup from "yup";
import { PageLayout } from "../../page-layout";
import { useAdminApp } from "../../use-admin-app";

type SecretRow = {
  key: string,
  // null when the key is only referenced by a service definition but has no
  // stored value yet.
  updatedAtMillis: number | null,
  // Whether any currently-synced service references this key, and whether all
  // referencing definitions carry a default value (in which case a missing
  // stored value doesn't block deploys).
  referenced: boolean,
  requiredWithoutDefault: boolean,
};

function SetSecretDialog(props: {
  open?: boolean,
  onOpenChange?: (open: boolean) => void,
  trigger?: React.ReactNode,
  // Set when overwriting an existing/referenced key; the key field is fixed then.
  fixedKey?: string,
  existingKeys: string[],
  onDone: () => Promise<void>,
}) {
  const hexclaveAdminApp = useAdminApp();
  const project = hexclaveAdminApp.useProject();

  const formSchema = yup.object({
    key: yupString()
      .defined()
      .nonEmpty("Enter a secret key")
      .matches(DEPLOYMENT_SECRET_KEY_REGEX, "Secret keys must contain only letters, numbers, underscores, and hyphens"),
    value: yupString().defined().nonEmpty("Enter a value"),
  });

  const isOverwrite = props.fixedKey != null && props.existingKeys.includes(props.fixedKey);
  return <FormDialog
    open={props.open}
    onOpenChange={props.onOpenChange}
    trigger={props.trigger}
    title={props.fixedKey == null ? "Set secret" : (isOverwrite ? `Overwrite ${props.fixedKey}` : `Set ${props.fixedKey}`)}
    formSchema={formSchema}
    defaultValues={{ key: props.fixedKey ?? "", value: "" }}
    okButton={{ label: isOverwrite ? "Overwrite" : "Set secret" }}
    onSubmit={async (values) => {
      await project.setDeploymentSecret(values.key, values.value);
      await props.onDone();
    }}
    render={(form) => (
      <>
        <DesignAlert variant="info" description="Secret values are write-only: once set, they can be overwritten or deleted, but never viewed again. They are read server-side at deploy time to fill secret() env vars." />
        <InputField
          label="Key"
          name="key"
          control={form.control}
          placeholder="e.g. OPENAI_API_KEY"
          disabled={props.fixedKey != null}
        />
        <InputField
          label="Value"
          name="value"
          control={form.control}
          type="password"
          placeholder="Secret value"
          autoComplete="off"
        />
      </>
    )}
  />;
}

function SecretActionMenu({ secret, existingKeys, refresh }: {
  secret: SecretRow,
  existingKeys: string[],
  refresh: () => Promise<void>,
}) {
  const hexclaveAdminApp = useAdminApp();
  const project = hexclaveAdminApp.useProject();
  const [isSetOpen, setIsSetOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const hasStoredValue = secret.updatedAtMillis != null;

  return (
    <>
      <SetSecretDialog
        open={isSetOpen}
        onOpenChange={setIsSetOpen}
        fixedKey={secret.key}
        existingKeys={existingKeys}
        onDone={refresh}
      />
      <ActionDialog
        open={isDeleteOpen}
        onOpenChange={setIsDeleteOpen}
        title="Delete secret"
        danger
        okButton={{
          label: "Delete",
          onClick: async () => {
            await project.deleteDeploymentSecret(secret.key);
            await refresh();
          },
        }}
        cancelButton
      >
        <Typography>
          Do you really want to delete the value of <b>{secret.key}</b>?
          {secret.requiredWithoutDefault
            ? " Services reference this secret without a default value, so deploys will fail until it is set again."
            : " This can't be undone (the value can never be viewed)."}
        </Typography>
      </ActionDialog>
      <ActionCell
        items={[
          { item: hasStoredValue ? "Overwrite value" : "Set value", onClick: () => setIsSetOpen(true) },
          ...hasStoredValue ? ['-' as const, { item: "Delete", onClick: () => setIsDeleteOpen(true), danger: true }] : [],
        ]}
      />
    </>
  );
}

function formatUpdatedAt(millis: number): string {
  return new Date(millis).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function PageClient() {
  const hexclaveAdminApp = useAdminApp();
  const project = hexclaveAdminApp.useProject();

  const [rows, setRows] = useState<SecretRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Refreshes race: the "Set secret" button is usable while the slow
  // mount-time load is still in flight, and this page has no periodic poll to
  // self-correct — so a superseded response writing its stale snapshot last
  // would make a just-set secret vanish until the next user action. Only the
  // NEWEST refresh may write state.
  const refreshSequenceRef = useRef(0);

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequenceRef.current;
    try {
      const [storedSecrets, services] = await Promise.all([
        project.listDeploymentSecrets(),
        project.listDeploymentServices(),
      ]);
      if (sequence !== refreshSequenceRef.current) return;
      // Union of stored keys and the keys referenced by the synced service
      // definitions, so a secret that still needs a value shows up before
      // anyone has set it.
      const byKey = new Map<string, SecretRow>();
      for (const secret of storedSecrets) {
        byKey.set(secret.key, { key: secret.key, updatedAtMillis: secret.updated_at_millis, referenced: false, requiredWithoutDefault: false });
      }
      for (const service of services) {
        for (const envVar of service.env) {
          if (envVar.type !== "secret" || envVar.secret_key == null) continue;
          const existing = byKey.get(envVar.secret_key) ?? { key: envVar.secret_key, updatedAtMillis: null, referenced: false, requiredWithoutDefault: false };
          existing.referenced = true;
          if (envVar.secret_has_default !== true) existing.requiredWithoutDefault = true;
          byKey.set(envVar.secret_key, existing);
        }
      }
      setRows([...byKey.values()].sort((a, b) => stringCompare(a.key, b.key)));
      setLoadError(null);
    } catch (error) {
      if (sequence !== refreshSequenceRef.current) return;
      setLoadError(error instanceof Error ? error.message : String(error));
    }
  }, [project]);

  useEffect(() => {
    runAsynchronouslyWithAlert(refresh());
  }, [refresh]);

  const existingKeys = useMemo(() => (rows ?? []).filter((row) => row.updatedAtMillis != null).map((row) => row.key), [rows]);

  return (
    <PageLayout
      title="Secrets"
      description="Write-only values for the secret() env vars of your deployment services. Read at deploy time; never shown again after being set."
    >
      <SettingCard
        title="Deployment secrets"
        actions={
          <SetSecretDialog
            trigger={<Button>Set secret</Button>}
            existingKeys={existingKeys}
            onDone={refresh}
          />
        }
      >
        {loadError != null && <DesignAlert variant="error" description={`Failed to load secrets: ${loadError}`} />}
        {rows == null && loadError == null && (
          <div className="flex h-24 items-center justify-center">
            <Spinner />
          </div>
        )}
        {rows != null && rows.length === 0 && (
          <DesignAlert variant="info" description="No secrets yet. Secrets referenced by the services export of your hexclave.config.ts will show up here after a deploy — or set one ahead of time." />
        )}
        {rows != null && rows.length > 0 && (
          <div className="divide-y divide-border/60">
            {rows.map((row) => (
              <div key={row.key} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-sm text-foreground">{row.key}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {row.updatedAtMillis != null
                      ? `Value set · last updated ${formatUpdatedAt(row.updatedAtMillis)}`
                      : (row.requiredWithoutDefault
                        ? "No value set — deploys of services referencing this secret will fail"
                        : "No value set — referencing services fall back to their default value")}
                  </div>
                </div>
                {row.updatedAtMillis != null
                  ? <DesignBadge label="Set" color="green" size="sm" />
                  : (row.requiredWithoutDefault
                    ? <DesignBadge label="Missing" color="red" size="sm" />
                    : <DesignBadge label="Using default" color="orange" size="sm" />)}
                <SecretActionMenu secret={row} existingKeys={existingKeys} refresh={refresh} />
              </div>
            ))}
          </div>
        )}
      </SettingCard>
    </PageLayout>
  );
}
