"use client";
import { InternalApiKeyTable } from "@/components/data-table/api-key-table";
import { EnvKeys } from "@/components/env-keys";
import { SmartFormDialog } from "@/components/form-dialog";
import { SelectField } from "@/components/form-fields";
import { InternalApiKeyFirstView } from "@stackframe/stack";
import { ActionDialog, Button, Typography } from "@stackframe/stack-ui";
import { useTranslations } from 'next-intl';
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import * as yup from "yup";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";


export default function PageClient() {
  const t = useTranslations('apiKeys');
  const stackAdminApp = useAdminApp();
  const apiKeySets = stackAdminApp.useInternalApiKeys();
  const params = useSearchParams();
  const create = params.get("create") === "true";

  const [isNewApiKeyDialogOpen, setIsNewApiKeyDialogOpen] = useState(create);
  const [returnedApiKey, setReturnedApiKey] = useState<InternalApiKeyFirstView | null>(null);

  return (
    <PageLayout
      title={t('title')}
      actions={
        <Button onClick={() => setIsNewApiKeyDialogOpen(true)}>
          {t('createButton')}
        </Button>
      }
    >
      <InternalApiKeyTable apiKeys={apiKeySets} />

      <CreateDialog
        open={isNewApiKeyDialogOpen}
        onOpenChange={setIsNewApiKeyDialogOpen}
        onKeyCreated={setReturnedApiKey}
      />
      <ShowKeyDialog
        apiKey={returnedApiKey || undefined}
        onClose={() => setReturnedApiKey(null)}
      />

    </PageLayout>
  );
}

const neverInMs = 1000 * 60 * 60 * 24 * 365 * 200;

function CreateDialog(props: {
  open: boolean,
  onOpenChange: (open: boolean) => void,
  onKeyCreated?: (key: InternalApiKeyFirstView) => void,
}) {
  const t = useTranslations('apiKeys.createDialog');
  const stackAdminApp = useAdminApp();
  const params = useSearchParams();
  const defaultDescription = params.get("description");

  const expiresInOptions = {
    [1000 * 60 * 60 * 24 * 1]: t('expiresIn.1day'),
    [1000 * 60 * 60 * 24 * 7]: t('expiresIn.7days'),
    [1000 * 60 * 60 * 24 * 30]: t('expiresIn.30days'),
    [1000 * 60 * 60 * 24 * 90]: t('expiresIn.90days'),
    [1000 * 60 * 60 * 24 * 365]: t('expiresIn.1year'),
    [neverInMs]: t('expiresIn.never'),
  } as const;

  const formSchema = yup.object({
    description: yup.string().defined().label(t('descriptionLabel')).default(defaultDescription || ""),
    expiresIn: yup.string().default(neverInMs.toString()).label(t('expiresInLabel')).meta({
      stackFormFieldRender: (props) => (
        <SelectField {...props} options={Object.entries(expiresInOptions).map(([value, label]) => ({ value, label }))} />
      )
    }),
  });

  return <SmartFormDialog
    open={props.open}
    onOpenChange={props.onOpenChange}
    title={t('title')}
    formSchema={formSchema}
    okButton={{ label: t('createButton') }}
    onSubmit={async (values) => {
      const expiresIn = parseInt(values.expiresIn);
      const newKey = await stackAdminApp.createInternalApiKey({
        hasPublishableClientKey: true,
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

function ShowKeyDialog(props: {
  apiKey?: InternalApiKeyFirstView,
  onClose?: () => void,
}) {
  const t = useTranslations('apiKeys.showDialog');
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  if (!props.apiKey) return null;


  return (
    <ActionDialog
      open={!!props.apiKey}
      title={t('title')}
      okButton={{ label: t('closeButton') }}
      onClose={props.onClose}
      preventClose
      confirmText={t('confirmText')}
    >
      <div className="flex flex-col gap-4">
        <Typography>
          {t('message.start')}{" "}
          <span className="font-bold">
            {t('message.warning')}
          </span>
        </Typography>
        <EnvKeys
          projectId={project.id}
          publishableClientKey={props.apiKey.publishableClientKey}
          secretServerKey={props.apiKey.secretServerKey}
        />
      </div>
    </ActionDialog>
  );
}
