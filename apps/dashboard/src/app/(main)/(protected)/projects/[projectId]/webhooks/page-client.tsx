"use client";

import { Alert } from "@/components/ui/alert";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";
import { SvixProvider, useEndpoints, useNewEndpoint, useSvix } from "svix-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ActionCell } from "@/components/data-table/elements/cells";
import { SettingCard } from "@/components/settings";
import { Button } from "@/components/ui/button";
import * as yup from "yup";
import { urlSchema } from "@stackframe/stack-shared/dist/schema-fields";
import { SmartFormDialog } from "@/components/form-dialog";
import { useMemo, useState } from "react";
import { ActionDialog } from "@/components/action-dialog";
import Typography from "@/components/ui/typography";

type Endpoint = {
  id: string,
  url: string,
  description?: string,
};

const endpointFormSchema = yup.object({
  makeSureAlert: yup.mixed().meta({
    stackFormFieldRender: () => (
      <Alert> Make sure this is a trusted URL that you control.</Alert>
    ),
  }),
  url: urlSchema.required().label("URL"),
  description: yup.string().label("Description"),
});

function CreateDialog(props: {
  trigger: React.ReactNode,
  updateFn: () => void,
}) {
  const { svix, appId } = useSvix();

  return <SmartFormDialog
    trigger={props.trigger}
    title={"Create new endpoint"}
    formSchema={endpointFormSchema}
    okButton={{ label: "Create" }}
    onSubmit={async (values) => {
      await svix.endpoint.create(appId, { url: values.url, description: values.description });
      props.updateFn();
    }}
  />;
}

function EditDialog(props: {
  open: boolean,
  onClose: () => void,
  endpoint: Endpoint,
  updateFn: () => void,
}) {
  const { svix, appId } = useSvix();
  const formSchema = endpointFormSchema.default(props.endpoint);

  return <SmartFormDialog
    open={props.open}
    onClose={props.onClose}
    title={"Edit endpoint"}
    formSchema={formSchema}
    okButton={{ label: "Save" }}
    onSubmit={async (values) => {
      await svix.endpoint.update(appId, props.endpoint.id, { url: values.url, description: values.description });
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
      title="Delete domain"
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
      <Typography>
        Do you really want to remove <b>{props.endpoint.url}</b> from the endpoint list? The endpoint will no longer receive events.
      </Typography>
    </ActionDialog>
  );
}

function ActionMenu(props: { endpoint: Endpoint, updateFn: () => void }) {
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  return (
    <>
      <EditDialog
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
          { item: "Edit", onClick: () => setEditDialogOpen(true) },
          '-',
          { item: "Delete", onClick: () => setDeleteDialogOpen(true), danger: true }
        ]}
      />
    </>
  );
}

function Endpoints(props: { updateFn: () => void }) {
  const endpoints = useEndpoints();
  let content = null;

  if (endpoints.error) {
    content = <Alert>An error has occurred</Alert>;
  }

  if (endpoints.loading) {
    content = <Alert>Loading...</Alert>;
  }

  if (!endpoints.data?.length) {
    content = <Alert>No domains added yet.</Alert>;
  } else {
    content = (
      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[600px]">Endpoint URL</TableHead>
              <TableHead className="w-[300px]">Description</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {endpoints.data.map(endpoint => (
              <TableRow key={endpoint.id}>
                <TableCell>{endpoint.url}</TableCell>
                <TableCell>{endpoint.description}</TableCell>
                <TableCell className="flex justify-end gap-4">
                  <ActionMenu endpoint={endpoint} updateFn={props.updateFn} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }

  return (
    <SettingCard
      title="Endpoints"
      description="Endpoints are the URLs that we will send events to. Please make sure you control these endpoints, as they can receive sensitive data."
      actions={<CreateDialog trigger={<Button>Add new endpoint</Button>} updateFn={props.updateFn}/>}
    >
      {content}
    </SettingCard>
  );
}


export default function PageClient() {
  const stackAdminApp = useAdminApp();
  const svixToken = stackAdminApp.useSvixToken();
  const [updateCounter, setUpdateCounter] = useState(0);

  // This is a hack to make sure svix hooks update when content changes
  const svixTokenUpdated = useMemo(() => {
    return svixToken + '';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [svixToken, updateCounter]);

  return (
    <PageLayout
      title="Webhooks"
      description="Webhooks are used to sync users and teams events from Stack to your own server."
    >
      <SvixProvider
        token={svixTokenUpdated}
        appId={stackAdminApp.projectId}
        options={{ serverUrl: process.env.NEXT_PUBLIC_STACK_SVIX_SERVER_URL }}
      >
        <Endpoints updateFn={() => setUpdateCounter(x => x + 1)} />
      </SvixProvider>
    </PageLayout>
  );
}
