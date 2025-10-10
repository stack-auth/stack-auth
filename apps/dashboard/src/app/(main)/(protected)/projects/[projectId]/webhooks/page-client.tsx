"use client";

import { FormDialog, SmartFormDialog } from "@/components/form-dialog";
import { InputField } from "@/components/form-fields";
import { useRouter } from "@/components/router";
import { SettingCard } from "@/components/settings";
import { getPublicEnvVar } from '@/lib/env';
import { urlSchema } from "@stackframe/stack-shared/dist/schema-fields";
import { ActionCell, ActionDialog, Alert, Button, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Typography } from "@stackframe/stack-ui";
import { useTranslations } from 'next-intl';
import { useState } from "react";
import { SvixProvider, useEndpoints, useSvix } from "svix-react";
import * as yup from "yup";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";
import { getSvixResult } from "./utils";

type Endpoint = {
  id: string,
  url: string,
  description?: string,
};

function CreateDialog(props: {
  trigger: React.ReactNode,
  updateFn: () => void,
}) {
  const t = useTranslations('webhooks');
  const { svix, appId } = useSvix();

  const formSchema = yup.object({
    url: urlSchema.defined().label(t('createDialog.field.urlLabel')),
    description: yup.string().label(t('createDialog.field.descriptionLabel')),
  });

  return <FormDialog
    trigger={props.trigger}
    title={t('createDialog.title')}
    formSchema={formSchema}
    okButton={{ label: t('createDialog.button') }}
    onSubmit={async (values) => {
      await svix.endpoint.create(appId, { url: values.url, description: values.description });
      props.updateFn();
    }}
    render={(form) => (
      <>
        <Alert>
          {t('createDialog.alert.trustedUrl')}
        </Alert>
        <InputField
          label={t('createDialog.field.urlLabel')}
          name="url"
          control={form.control}
        />
        <InputField
          label={t('createDialog.field.descriptionLabel')}
          name="description"
          control={form.control}
        />
        {(form.watch('url') as any)?.startsWith('http://') && (
          <Alert variant="destructive">
            {t('createDialog.alert.httpWarning')}
          </Alert>
        )}
      </>
    )}
  />;
}

export function EndpointEditDialog(props: {
  open: boolean,
  onClose: () => void,
  endpoint: Endpoint,
  updateFn: () => void,
}) {
  const t = useTranslations('webhooks');
  const { svix, appId } = useSvix();

  const formSchema = yup.object({
    description: yup.string().label(t('editDialog.field.descriptionLabel')),
  }).default(props.endpoint);

  return <SmartFormDialog
    open={props.open}
    onClose={props.onClose}
    title={t('editDialog.title')}
    formSchema={formSchema}
    okButton={{ label: t('editDialog.button') }}
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
  const t = useTranslations('webhooks');
  const { svix, appId } = useSvix();
  return (
    <ActionDialog
      open={props.open}
      onClose={props.onClose}
      title={t('deleteDialog.title')}
      danger
      okButton={{
        label: t('deleteDialog.button'),
        onClick: async () => {
          await svix.endpoint.delete(appId, props.endpoint.id);
          props.updateFn();
        }
      }}
      cancelButton
    >
      <Typography>
        {t('deleteDialog.message', { url: props.endpoint.url })}
      </Typography>
    </ActionDialog>
  );
}

function ActionMenu(props: { endpoint: Endpoint, updateFn: () => void }) {
  const t = useTranslations('webhooks');
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
          { item: t('actionMenu.viewDetails'), onClick: () => router.push(`/projects/${project.id}/webhooks/${props.endpoint.id}`) },
          { item: t('actionMenu.edit'), onClick: () => setEditDialogOpen(true) },
          '-',
          { item: t('actionMenu.delete'), onClick: () => setDeleteDialogOpen(true), danger: true }
        ]}
      />
    </>
  );
}

function Endpoints(props: { updateFn: () => void }) {
  const t = useTranslations('webhooks');
  const endpoints = getSvixResult(useEndpoints({ limit: 100 }));

  if (!endpoints.loaded) {
    return endpoints.rendered;
  } else {
    return (
      <SettingCard
        title={t('endpoints.title')}
        description={t('endpoints.description')}
        actions={<CreateDialog trigger={<Button>{t('endpoints.addButton')}</Button>} updateFn={props.updateFn}/>}
      >
        <div className="border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[600px]">{t('endpoints.table.url')}</TableHead>
                <TableHead className="w-[300px]">{t('endpoints.table.description')}</TableHead>
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
      </SettingCard>
    );
  }
}

export default function PageClient() {
  const t = useTranslations('webhooks');
  const stackAdminApp = useAdminApp();
  const svixToken = stackAdminApp.useSvixToken();
  const [updateCounter, setUpdateCounter] = useState(0);

  return (
    <PageLayout
      title={t('title')}
      description={t('description')}
    >
      <SvixProvider
        key={updateCounter}
        token={svixToken}
        appId={stackAdminApp.projectId}
        options={{ serverUrl: getPublicEnvVar('NEXT_PUBLIC_STACK_SVIX_SERVER_URL') }}
      >
        <Endpoints updateFn={() => setUpdateCounter(x => x + 1)} />
      </SvixProvider>
    </PageLayout>
  );
}
