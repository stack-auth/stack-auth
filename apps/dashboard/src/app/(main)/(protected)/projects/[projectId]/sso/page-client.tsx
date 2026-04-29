"use client";

import { SmartFormDialog } from "@/components/form-dialog";
import { ActionDialog, Alert, Button, Card, CardContent, CardHeader, Typography } from "@/components/ui";
import { useUpdateConfig } from "@/lib/config-update";
import React, { useState } from "react";
import * as yup from "yup";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";

/**
 * Dashboard for managing SAML SSO connections on the current project.
 *
 * Connection config is stored at tenancy.config.auth.saml.connections —
 * the same JSON-config the seed script and admin /saml-connections
 * endpoints write. This page reads via project.useConfig() and writes
 * via useUpdateConfig() with key paths.
 *
 * V1 scope: single-page list with create + delete dialogs. The
 * paste-IdP-metadata helper that auto-fills idpEntityId/idpSsoUrl/
 * idpCertificate from a single XML blob is a planned follow-up — for
 * now connection fields are entered manually.
 */
export default function PageClient() {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const config = project.useConfig();
  const connections = config.auth.saml.connections;

  const [createOpen, setCreateOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const connectionEntries = Object.entries(connections);

  return (
    <PageLayout
      title="SAML SSO"
      description="Manage SAML 2.0 connections so corporate IdP users can sign in to your project."
      actions={<Button onClick={() => setCreateOpen(true)}>Add SAML connection</Button>}
    >
      {connectionEntries.length === 0 && (
        <Alert>
          No SAML connections configured yet. Click <strong>Add SAML connection</strong> to wire
          up your first IdP.
        </Alert>
      )}

      <div className="grid gap-4">
        {connectionEntries.map(([id, conn]) => (
          <Card key={id}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <Typography type="h4">{conn.displayName}</Typography>
                  <Typography type="p" variant="secondary" className="text-sm">
                    Connection ID: <code>{id}</code>
                    {conn.domain && (
                      <>
                        {" "}· Email domain: <code>{conn.domain}</code>
                      </>
                    )}
                  </Typography>
                </div>
                <div className="flex gap-2">
                  <Button variant="destructive" size="sm" onClick={() => setDeleteId(id)}>
                    Delete
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid gap-2 text-sm">
                <DetailRow label="IdP Entity ID" value={conn.idpEntityId} />
                <DetailRow label="IdP SSO URL" value={conn.idpSsoUrl} />
                <DetailRow
                  label="IdP signing cert"
                  value={conn.idpCertificate ? `<${conn.idpCertificate.length}-char certificate>` : null}
                />
                <DetailRow label="Sign-in enabled" value={conn.allowSignIn ? "yes" : "no"} />
              </div>
              <div className="mt-3 grid gap-1 text-sm border-t pt-3">
                <Typography type="p" variant="secondary" className="text-xs">
                  Paste these into your IdP&apos;s admin console:
                </Typography>
                <DetailRow
                  label="SP metadata URL"
                  value={`/api/v1/auth/saml/metadata/${id}?project_id=${project.id}`}
                  mono
                />
                <DetailRow
                  label="ACS URL"
                  value={`/api/v1/auth/saml/acs/${id}`}
                  mono
                />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <CreateDialog open={createOpen} onOpenChange={setCreateOpen} />
      <DeleteDialog
        connectionId={deleteId}
        onClose={() => setDeleteId(null)}
        displayName={deleteId ? connections[deleteId].displayName : null}
      />
    </PageLayout>
  );
}

function DetailRow({ label, value, mono }: { label: string, value: string | null | undefined, mono?: boolean }) {
  return (
    <div className="flex gap-2">
      <span className="font-medium min-w-[140px]">{label}:</span>
      <span className={mono ? "font-mono break-all" : "break-all"}>
        {value ? value : <em className="text-gray-500">not set</em>}
      </span>
    </div>
  );
}

function CreateDialog({ open, onOpenChange }: { open: boolean, onOpenChange: (open: boolean) => void }) {
  const stackAdminApp = useAdminApp();
  const updateConfig = useUpdateConfig();

  const formSchema = yup.object({
    id: yup.string()
      .matches(/^[a-z0-9_-]+$/, "ID can only contain lowercase letters, digits, underscores, and dashes")
      .nonEmpty().label("Connection ID"),
    displayName: yup.string().nonEmpty().label("Display name"),
    domain: yup.string().optional().label("Email domain (for discovery)"),
    idpEntityId: yup.string().nonEmpty().label("IdP Entity ID"),
    idpSsoUrl: yup.string().url().nonEmpty().label("IdP SSO URL"),
    idpCertificate: yup.string().nonEmpty().label("IdP signing certificate (X.509, base64)"),
    allowSignIn: yup.boolean().default(true).label("Enable sign-in"),
  });

  return (
    <SmartFormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add a SAML connection"
      formSchema={formSchema}
      okButton={{ label: "Create" }}
      cancelButton
      onSubmit={async (values) => {
        // Set the whole connection entry as a single value. Deep dot-keys
        // (e.g. `auth.saml.connections.X.displayName`) get dropped during
        // config normalization when the parent record entry doesn't yet
        // exist — same convention as auth.oauth.providers in the
        // auth-methods page.
        await updateConfig({
          adminApp: stackAdminApp,
          configUpdate: {
            [`auth.saml.connections.${values.id}`]: {
              displayName: values.displayName,
              allowSignIn: values.allowSignIn,
              domain: values.domain || undefined,
              idpEntityId: values.idpEntityId,
              idpSsoUrl: values.idpSsoUrl,
              idpCertificate: (values.idpCertificate ?? "").replace(/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\s+/g, ""),
            },
          } as Parameters<typeof updateConfig>[0]["configUpdate"],
          pushable: true,
        });
      }}
    />
  );
}

function DeleteDialog({ connectionId, displayName, onClose }: {
  connectionId: string | null,
  displayName: string | null,
  onClose: () => void,
}) {
  const stackAdminApp = useAdminApp();
  const updateConfig = useUpdateConfig();

  return (
    <ActionDialog
      open={connectionId != null}
      onOpenChange={(open) => { if (!open) onClose(); }}
      title="Delete SAML connection?"
      danger
      okButton={{
        label: "Delete connection",
        onClick: async () => {
          if (!connectionId) return;
          await updateConfig({
            adminApp: stackAdminApp,
            configUpdate: { [`auth.saml.connections.${connectionId}`]: null } as Parameters<typeof updateConfig>[0]["configUpdate"],
            pushable: true,
          });
          onClose();
        },
      }}
      cancelButton
    >
      <Typography>
        Delete <strong>{displayName ?? "this connection"}</strong>? Existing user accounts linked
        via this connection will remain in the database but will no longer be able to sign in.
      </Typography>
    </ActionDialog>
  );
}
