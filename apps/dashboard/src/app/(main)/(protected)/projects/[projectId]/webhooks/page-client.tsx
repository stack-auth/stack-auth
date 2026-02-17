"use client";

import { SmartFormDialog } from "@/components/form-dialog";
import { InputField } from "@/components/form-fields";
import { useRouter } from "@/components/router";
import { DesignAlert, DesignBadge, DesignButton, DesignCard, DesignDataTable } from "@/components/design-components";
import { getPublicEnvVar } from '@/lib/env';
import { urlSchema } from "@stackframe/stack-shared/dist/schema-fields";
import { yupResolver } from "@hookform/resolvers/yup";
import { ActionCell, ActionDialog, Form, Typography } from "@/components/ui";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { SvixProvider, useEndpoints, useSvix } from "svix-react";
import * as yup from "yup";
import { AppEnabledGuard } from "../app-enabled-guard";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";
import { getSvixResult } from "./utils";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { useTheme } from "next-themes";
import { AppPortal } from "svix-react";
import type { ColumnDef } from "@tanstack/react-table";
import { GlobeHemisphereWestIcon } from "@phosphor-icons/react";
import "svix-react/style.css";


export default function PageClient() {
  const stackAdminApp = useAdminApp();
  const svixToken = stackAdminApp.useSvixToken();
  const { resolvedTheme } = useTheme();
  const [updateCounter, setUpdateCounter] = useState(0);
  const [testDialogEndpoint, setTestDialogEndpoint] = useState<Endpoint | null>(null);

  return (
    <AppEnabledGuard appId="webhooks">
      <PageLayout
        title="Webhooks"
        description="Webhooks are used to sync users and teams events from Stack to your own server."
      >
        {svixToken.url ? (
          <div>
            <AppPortal url={svixToken.url} darkMode={resolvedTheme === "dark"} fullSize />
          </div>
        ) : (
          <SvixProvider
            key={updateCounter}
            token={svixToken.token}
            appId={stackAdminApp.projectId}
            options={{ serverUrl: getPublicEnvVar('NEXT_PUBLIC_STACK_SVIX_SERVER_URL') }}
          >
            <Endpoints
              updateFn={() => setUpdateCounter(x => x + 1)}
              onTestRequested={(endpoint) => setTestDialogEndpoint(endpoint)}
            />
            {testDialogEndpoint && (
              <TestEndpointDialog
                endpoint={testDialogEndpoint}
                open
                onOpenChange={(open) => {
                  if (!open) {
                    setTestDialogEndpoint(null);
                  }
                }}
              />
            )}
          </SvixProvider>
        )}
      </PageLayout>
    </AppEnabledGuard>
  );
}

type Endpoint = {
  id: string,
  url: string,
  description?: string,
  disabled: boolean,
};

function CreateDialog(props: {
  trigger: React.ReactNode,
  updateFn: () => void,
  onTestRequested?: (endpoint: Endpoint) => void,
}) {
  const { svix, appId } = useSvix();
  const [open, setOpen] = useState(false);
  const [createdEndpoint, setCreatedEndpoint] = useState<Endpoint | null>(null);

  const formSchema = yup.object({
    url: urlSchema.defined().label("URL"),
    description: yup.string().label("Description"),
  });

  const form = useForm<yup.InferType<typeof formSchema>>({
    resolver: yupResolver(formSchema),
    defaultValues: {
      url: "",
      description: "",
    },
    mode: "onChange",
  });

  const handleOpenChange = (value: boolean) => {
    setOpen(value);
    if (!value) {
      props.updateFn();
    }
    form.reset();
    setCreatedEndpoint(null);
  };

  const handleSubmit = form.handleSubmit(async (values) => {
    const created = await svix.endpoint.create(appId, { url: values.url, description: values.description });
    setCreatedEndpoint({
      id: created.id,
      url: created.url,
      description: created.description,
      disabled: created.disabled ?? false,
    });
  });

  const allowInsecureWarning = form.watch("url").startsWith("http://");

  return (
    <ActionDialog
      trigger={props.trigger}
      title={"Create new endpoint"}
      open={open}
      onOpenChange={handleOpenChange}
      okButton={false}
      cancelButton={false}
    >
      {createdEndpoint ? (
        <div className="space-y-6">
          <DesignAlert
            variant="success"
            title="Endpoint created"
            description={<>
              <span className="block">
                <span className="font-semibold">URL:</span> {createdEndpoint.url}
              </span>
              {createdEndpoint.description ? (
                <span className="block">
                  <span className="font-semibold">Description:</span> {createdEndpoint.description}
                </span>
              ) : null}
              <span className="block pt-2">
                You can now send a test event to verify your integration.
              </span>
            </>}
          />
          <div className="flex justify-end gap-2">
            <DesignButton
              variant="outline"
              onClick={() => handleOpenChange(false)}
            >
              Close
            </DesignButton>
            <DesignButton
              onClick={() => {
                props.onTestRequested?.(createdEndpoint);
                handleOpenChange(false);
              }}
            >
              Test endpoint
            </DesignButton>
          </div>
        </div>
      ) : (
        <Form {...form}>
          <form
            onSubmit={(e) => runAsynchronously(handleSubmit(e))}
            className="space-y-4"
          >
            <DesignAlert
              variant="info"
              description="Make sure this is a trusted URL that you control."
            />
            <InputField
              label="URL"
              name="url"
              control={form.control}
            />
            <InputField
              label="Description"
              name="description"
              control={form.control}
            />
            {allowInsecureWarning && (
              <DesignAlert
                variant="error"
                description="Using HTTP endpoints is insecure. This can expose your user data to attackers. Only use HTTP endpoints in development environments."
              />
            )}
            <div className="flex justify-end gap-2 pt-2">
              <DesignButton
                variant="outline"
                type="button"
                onClick={() => handleOpenChange(false)}
              >
                Cancel
              </DesignButton>
              <DesignButton
                type="submit"
                disabled={!form.formState.isValid}
              >
                Create
              </DesignButton>
            </div>
          </form>
        </Form>
      )}
    </ActionDialog>
  );
}

function EndpointEditDialog(props: {
  open: boolean,
  onClose: () => void,
  endpoint: Endpoint,
  updateFn: () => void,
}) {
  const { svix, appId } = useSvix();

  const formSchema = yup.object({
    description: yup.string().label("Description"),
  }).default(props.endpoint);

  return <SmartFormDialog
    open={props.open}
    onClose={props.onClose}
    title={"Edit endpoint"}
    formSchema={formSchema}
    okButton={{ label: "Save" }}
    onSubmit={async (values) => {
      await svix.endpoint.update(appId, props.endpoint.id, { url: props.endpoint.url, description: values.description });
      props.updateFn();
    }}
  />;
}

function DeleteDialog(props: {
  open?: boolean,
  onClose?: () => void,
  endpoint: Endpoint,
  updateFn: () => void,
}) {
  const { svix, appId } = useSvix();
  return (
    <ActionDialog
      open={props.open}
      onClose={props.onClose}
      title="Delete endpoint"
      danger
      okButton={{
        label: "Delete",
        onClick: async () => {
          await svix.endpoint.delete(appId, props.endpoint.id);
          props.updateFn();
        }
      }}
      cancelButton
    >
      <Typography className="text-sm text-foreground/80">
        Do you really want to remove <b>{props.endpoint.url}</b> from the endpoint list? The endpoint will no longer receive events.
      </Typography>
    </ActionDialog>
  );
}

function TestEndpointDialog(props: { endpoint: Endpoint, open: boolean, onOpenChange: (open: boolean) => void }) {
  const stackAdminApp = useAdminApp();
  const [status, setStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const previewPayload = useMemo(() => JSON.stringify({
    type: "stack.test",
    data: {
      message: "Stack webhook test event triggered from the Stack dashboard.",
      endpointUrl: props.endpoint.url,
    },
  }, null, 2), [props.endpoint.url]);

  const resetState = () => {
    setStatus('idle');
    setErrorMessage(null);
  };

  const sendTestEvent = async () => {
    setStatus('sending');
    setErrorMessage(null);

    const result = await stackAdminApp.sendTestWebhook({ endpointId: props.endpoint.id });
    if (result.status === 'ok') {
      setStatus('success');
      return;
    }
    setStatus('error');
    setErrorMessage(result.error.errorMessage);
  };

  return (
    <ActionDialog
      open={props.open}
      onOpenChange={(value) => {
        props.onOpenChange(value);
        if (!value) {
          resetState();
        }
      }}
      title="Send a test webhook"
      okButton={{
        label: 'Send test event',
        onClick: async () => {
          await sendTestEvent();
          return 'prevent-close';
        },
      }}
      cancelButton={status === 'sending' ? false : { label: 'Cancel' }}
    >
      <div className="space-y-4">
        <DesignAlert
          variant="info"
          description={<>
            We&apos;ll send a simple <code className="rounded bg-muted px-1 py-0.5">stack.test</code> event to <span >{props.endpoint.url}</span> and check if it was delivered successfully.
          </>}
        />

        <div>
          <Typography type='label' className="text-xs uppercase tracking-wide text-muted-foreground">Sample payload</Typography>
          <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-muted p-4 text-xs leading-relaxed">{previewPayload}</pre>
        </div>

        {status === 'success' && (
          <DesignAlert
            variant='success'
            title="Event sent"
            description={<>
              Test event was sent successfully.
              <br />
              Your endpoint is properly configured and ready to receive events.
            </>}
          />
        )}

        {status === 'error' && errorMessage && (
          <DesignAlert
            variant='error'
            title="Unable to send event"
            description={errorMessage}
          />
        )}
      </div>
    </ActionDialog>
  );
}

function ActionMenu(props: { endpoint: Endpoint, updateFn: () => void, onTestEndpoint: (endpoint: Endpoint) => void }) {
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const router = useRouter();
  const app = useAdminApp();
  const project = app.useProject();

  return (
    <>
      <EndpointEditDialog
        open={editDialogOpen}
        onClose={() => setEditDialogOpen(false)}
        endpoint={props.endpoint}
        updateFn={props.updateFn}
      />
      <DeleteDialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        endpoint={props.endpoint}
        updateFn={props.updateFn}
      />
      <ActionCell
        items={[
          { item: "View Details", onClick: () => router.push(`/projects/${project.id}/webhooks/${props.endpoint.id}`) },
          { item: "Test", onClick: () => props.onTestEndpoint(props.endpoint) },
          { item: "Edit", onClick: () => setEditDialogOpen(true) },
          '-',
          { item: "Delete", onClick: () => setDeleteDialogOpen(true), danger: true }
        ]}
      />
    </>
  );
}

function Endpoints(props: { updateFn: () => void, onTestRequested: (endpoint: Endpoint) => void }) {
  const endpoints = getSvixResult(useEndpoints({ limit: 100 }));

  if (!endpoints.loaded) {
    return endpoints.rendered;
  } else {
    const columns: ColumnDef<Endpoint>[] = [
      {
        accessorKey: "url",
        header: "Endpoint URL",
        cell: ({ row }) => (
          <span className="text-sm font-medium text-foreground">{row.original.url}</span>
        ),
      },
      {
        accessorKey: "description",
        header: "Description",
        cell: ({ row }) => (
          row.original.description ? (
            <span className="text-sm text-foreground/80">{row.original.description}</span>
          ) : (
            <span className="text-sm text-muted-foreground">-</span>
          )
        ),
      },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => (
          <DesignBadge
            label={row.original.disabled ? "Disabled" : "Active"}
            color={row.original.disabled ? "red" : "green"}
            size="sm"
          />
        ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <div className="flex justify-end">
            <ActionMenu
              endpoint={row.original}
              updateFn={props.updateFn}
              onTestEndpoint={props.onTestRequested}
            />
          </div>
        ),
      },
    ];

    const endpointRows: Endpoint[] = endpoints.data.map((endpoint) => ({
      ...endpoint,
      description: endpoint.description,
      disabled: endpoint.disabled ?? false,
    }));

    return (
      <DesignCard
        title="Endpoints"
        subtitle="Endpoints are the URLs that we will send events to. Please make sure you control these endpoints, as they can receive sensitive data."
        icon={GlobeHemisphereWestIcon}
        glassmorphic
        actions={(
          <CreateDialog
            trigger={<DesignButton>Add new endpoint</DesignButton>}
            updateFn={props.updateFn}
            onTestRequested={props.onTestRequested}
          />
        )}
      >
        <DesignDataTable
          data={endpointRows}
          columns={columns}
          defaultColumnFilters={[]}
          defaultSorting={[]}
        />
      </DesignCard>
    );
  }
}
