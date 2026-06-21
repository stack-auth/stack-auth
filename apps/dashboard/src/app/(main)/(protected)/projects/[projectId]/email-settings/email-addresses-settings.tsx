"use client";

import { SmartFormDialog } from "@/components/form-dialog";
import { SelectField } from "@/components/form-fields";
import { DesignAlert, DesignBadge, DesignButton, DesignCard } from "@/components/design-components";
import { useUpdateConfig } from "@/lib/config-update";
import { EnvelopeSimple, Plus, Trash } from "@phosphor-icons/react";
import { generateUuid } from "@hexclave/shared/dist/utils/uuids";
import { stringCompare } from "@hexclave/shared/dist/utils/strings";
import { ActionDialog, Typography } from "@/components/ui";
import { useState } from "react";
import * as yup from "yup";
import { useAdminApp } from "../use-admin-app";

type EmailAddressRole = "sender" | "support";

const ROLE_LABELS: Record<EmailAddressRole, string> = {
  sender: "Sender",
  support: "Support",
};

const ROLE_COLORS: Record<EmailAddressRole, "blue" | "purple"> = {
  sender: "blue",
  support: "purple",
};

export function EmailAddressesSettings() {
  const hexclaveAdminApp = useAdminApp();
  const project = hexclaveAdminApp.useProject();
  const config = project.useConfig();
  const updateConfig = useUpdateConfig();

  const isShared = config.emails.server.isShared;
  // Stable, sorted list so the UI doesn't reorder as the record is mutated.
  // Rendered config marks `email` as possibly-undefined, so narrow to well-formed
  // entries (every address we write always has an email).
  const addresses = Object.entries(config.emails.addresses)
    .map(([id, address]) => ({ id, email: address.email, displayName: address.displayName, role: address.role }))
    .filter((a): a is { id: string, email: string, displayName: string | undefined, role: EmailAddressRole } =>
      a.email != null)
    .sort((a, b) => stringCompare(a.email, b.email));

  const [addOpen, setAddOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string, email: string } | null>(null);

  return (
    <DesignCard gradient="default">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-foreground/[0.06] dark:bg-foreground/[0.04]">
              <EnvelopeSimple className="h-3.5 w-3.5 text-foreground/70 dark:text-muted-foreground" />
            </div>
            <span className="text-xs font-semibold text-foreground uppercase tracking-wider">Email Addresses</span>
          </div>
          {!isShared && (
            <DesignButton size="sm" className="gap-1.5" onClick={() => setAddOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> Add address
            </DesignButton>
          )}
        </div>

        <Typography variant="secondary" className="text-sm">
          Configure additional addresses you can send from. <span className="font-medium text-foreground">Support</span> addresses
          also receive inbound email, routed into Conversations.
        </Typography>

        {isShared ? (
          <DesignAlert
            variant="info"
            description="Configure a custom email server (above) before adding addresses — the shared server only sends Stack's default sender."
          />
        ) : addresses.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/60 p-6 text-center">
            <EnvelopeSimple size={24} className="mx-auto text-muted-foreground/50" />
            <div className="text-sm font-medium text-foreground mt-2">No additional addresses</div>
            <div className="text-xs text-muted-foreground mt-1">Add a sender or support address to get started.</div>
          </div>
        ) : (
          <div className="rounded-lg border border-border/60 divide-y divide-border/50 overflow-hidden">
            {addresses.map((address) => (
              <div key={address.id} className="flex items-center justify-between px-4 py-3 gap-3 min-w-0">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <EnvelopeSimple className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-mono text-foreground truncate" title={address.email}>
                      {address.email}
                    </div>
                    {address.displayName != null && address.displayName.length > 0 && (
                      <div className="text-[11px] text-muted-foreground mt-0.5 truncate">{address.displayName}</div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <DesignBadge label={ROLE_LABELS[address.role]} color={ROLE_COLORS[address.role]} size="sm" />
                  <button
                    type="button"
                    title="Remove address"
                    aria-label={`Remove address ${address.email}`}
                    onClick={() => setConfirmDelete({ id: address.id, email: address.email })}
                    className="shrink-0 p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <Trash className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <SmartFormDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        title="Add email address"
        description="Add an address you can send from. Support addresses also receive inbound mail."
        formSchema={yup.object({
          email: yup.string().email("Enter a valid email address").defined().label("Email address"),
          displayName: yup.string().optional().label("Display name"),
          role: yup.string().oneOf(["sender", "support"]).defined().default("sender").label("Role").meta({
            stackFormFieldRender: (props: any) => (
              <SelectField
                {...props}
                label="Role"
                required
                options={[
                  { value: "sender", label: "Sender — send from this address" },
                  { value: "support", label: "Support — send & receive inbound" },
                ]}
              />
            ),
          }),
        })}
        okButton={{ label: "Add" }}
        cancelButton
        onSubmit={async (values) => {
          const id = generateUuid();
          await updateConfig({
            adminApp: hexclaveAdminApp,
            configUpdate: {
              [`emails.addresses.${id}`]: {
                email: values.email,
                displayName: values.displayName != null && values.displayName.length > 0 ? values.displayName : undefined,
                role: values.role,
              },
            },
            pushable: false,
          });
        }}
      />

      <ActionDialog
        open={confirmDelete !== null}
        onOpenChange={(open) => { if (!open) setConfirmDelete(null); }}
        title="Remove email address"
        danger
        okButton={{
          label: "Remove",
          onClick: async () => {
            if (!confirmDelete) return;
            await updateConfig({
              adminApp: hexclaveAdminApp,
              configUpdate: {
                [`emails.addresses.${confirmDelete.id}`]: null,
              },
              pushable: false,
            });
          },
        }}
        cancelButton
      >
        <Typography>
          Remove <span className="font-mono">{confirmDelete?.email}</span>? Emails already queued to send from this address
          will fall back to the project&apos;s default sender.
        </Typography>
      </ActionDialog>
    </DesignCard>
  );
}
