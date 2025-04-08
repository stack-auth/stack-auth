"use client";
import { InternalApiKeyTable } from "@/components/data-table/api-key-table";
import EnvKeys from "@/components/env-keys";
import { SmartFormDialog } from "@/components/form-dialog";
import { SelectField } from "@/components/form-fields";
import { InternalApiKeyFirstView } from "@stackframe/stack";
import { ActionDialog, Button, Typography } from "@stackframe/stack-ui";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import * as yup from "yup";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";


export default function PageClient() {
  const stackAdminApp = useAdminApp();
  const apiKeySets = stackAdminApp.useInternalApiKeys();
  const params = useSearchParams();
  const create = params.get("create") === "true";

  const [isNewApiKeyDialogOpen, setIsNewApiKeyDialogOpen] = useState(create);
  const [returnedApiKey, setReturnedApiKey] = useState<InternalApiKeyFirstView | null>(null);

  return (
    <PageLayout
      title="Stack Auth Keys"
      actions={
        <Button onClick={() => setIsNewApiKeyDialogOpen(true)}>
          Create Stack Auth Keys
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
const expiresInOptions = {
  [1000 * 60 * 60 * 24 * 1]: "1 day",
  [1000 * 60 * 60 * 24 * 7]: "7 days",
  [1000 * 60 * 60 * 24 * 30]: "30 days",
  [1000 * 60 * 60 * 24 * 90]: "90 days",
  [1000 * 60 * 60 * 24 * 365]: "1 year",
  [neverInMs]: "Never",
} as const;

function CreateDialog(props: {
  open: boolean,
  onOpenChange: (open: boolean) => void,
  onKeyCreated?: (key: InternalApiKeyFirstView) => void,
}) {
  const stackAdminApp = useAdminApp();
  const params = useSearchParams();
  const defaultDescription = params.get("description");

  const formSchema = yup.object({
    description: yup.string().defined().label("Description").default(defaultDescription || ""),
    expiresIn: yup.string().default(neverInMs.toString()).label("Expires in").meta({
      stackFormFieldRender: (props) => (
        <SelectField {...props} options={Object.entries(expiresInOptions).map(([value, label]) => ({ value, label }))} />
      )
    }),
  });

  return <SmartFormDialog
    open={props.open}
    onOpenChange={props.onOpenChange}
    title="Create Stack Auth Keys"
    formSchema={formSchema}
    okButton={{ label: "Create" }}
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
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  if (!props.apiKey) return null;


  return (
    <ActionDialog
      open={!!props.apiKey}
      title="Stack Auth Keys"
      okButton={{ label: "Close" }}
      onClose={props.onClose}
      preventClose
      confirmText="I understand that I will not be able to view these keys again."
    >
      <div className="flex flex-col gap-4">
        <Typography>
          Here are your Stack Auth keys.{" "}
          <span className="font-bold">
            Copy them to a safe place. You will not be able to view them again.
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
