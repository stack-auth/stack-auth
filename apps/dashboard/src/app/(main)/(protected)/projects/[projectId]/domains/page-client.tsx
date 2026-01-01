"use client";
import { FormDialog } from "@/components/form-dialog";
import { InputField, SwitchField } from "@/components/form-fields";
import { InlineSaveDiscard } from "@/components/inline-save-discard";
import { SettingCard, SettingSwitch } from "@/components/settings";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger, ActionCell, ActionDialog, Alert, Button, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Typography } from "@/components/ui";
import { useUpdateConfig } from "@/lib/config-update";
import { yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { typedEntries } from "@stackframe/stack-shared/dist/utils/objects";
import { isValidHostnameWithWildcards, isValidUrl } from "@stackframe/stack-shared/dist/utils/urls";
import { generateUuid } from "@stackframe/stack-shared/dist/utils/uuids";
import React, { useState } from "react";
import * as yup from "yup";
import { AppEnabledGuard } from "../app-enabled-guard";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";

type DomainEntry = {
  id: string,
  baseUrl: string,
  handlerPath: string,
};

function EditDialog(props: {
  open?: boolean,
  onOpenChange?: (open: boolean) => void,
  trigger?: React.ReactNode,
  domains: DomainEntry[],
  type: 'update' | 'create',
} & (
  {
    type: 'create',
  } |
  {
    type: 'update',
    editId: string,
    defaultDomain: string,
    defaultHandlerPath: string,
  }
)) {
  const stackAdminApp = useAdminApp();
  const updateConfig = useUpdateConfig();

  const domainFormSchema = yup.object({
    domain: yupString()
      .test({
        name: 'domain',
        message: (params) => `Invalid domain`,
        test: (value) => value == null || isValidHostnameWithWildcards(value)
      })
      .test({
        name: 'unique-domain',
        message: "Domain already exists",
        test: function(value) {
          if (!value) return true;
          const { addWww, insecureHttp } = this.parent;

          // Get all existing domains except the one being edited
          const existingDomains = props.domains
            .filter((d) => (props.type === 'update' && d.id !== props.editId) || props.type === 'create')
            .map(({ baseUrl }) => baseUrl);

          // Generate all variations of the domain being tested
          const variations = [];
          const protocols = insecureHttp ? ['http://', 'https://'] : ['https://'];
          const prefixes = addWww ? ['', 'www.'] : [''];

          for (const protocol of protocols) {
            for (const prefix of prefixes) {
              variations.push(protocol + prefix + value);
            }
          }

          // Check if any variation exists in existing domains
          return !variations.some(variation => existingDomains.includes(variation));
        }
      })
      .defined(),
    handlerPath: yup.string()
      .matches(/^\//, "Handler path must start with /")
      .defined(),
    addWww: yup.boolean(),
    insecureHttp: yup.boolean(),
  });

  const canAddWww = (domain: string | undefined) => {
    if (!domain) {
      return false;
    }

    // Don't allow adding www. to wildcard domains
    if (domain.includes('*')) {
      return false;
    }

    const httpsUrl = 'https://' + domain;
    if (!isValidUrl(httpsUrl)) {
      return false;
    }

    if (domain.startsWith('www.')) {
      return false;
    }

    const wwwUrl = 'https://www.' + domain;
    return isValidUrl(wwwUrl);
  };

  return <FormDialog
    open={props.open}
    defaultValues={{
      addWww: props.type === 'create',
      domain: props.type === 'update' ? props.defaultDomain.replace(/^https?:\/\//, "") : undefined,
      handlerPath: props.type === 'update' ? props.defaultHandlerPath : "/handler",
      insecureHttp: false,
    }}
    onOpenChange={props.onOpenChange}
    trigger={props.trigger}
    title={(props.type === 'create' ? "Create" : "Update") + " domain and handler"}
    formSchema={domainFormSchema}
    okButton={{ label: props.type === 'create' ? "Create" : "Save" }}
    onSubmit={async (values) => {
      const protocol = values.insecureHttp ? 'http://' : 'https://';
      const baseUrl = protocol + values.domain;
      const wwwBaseUrl = protocol + 'www.' + values.domain;

      try {
        if (props.type === 'create') {
          // Create new domain(s)
          const newDomainId = generateUuid();
          const configUpdate: Record<string, any> = {
            [`domains.trustedDomains.${newDomainId}`]: {
              baseUrl,
              handlerPath: values.handlerPath,
            },
          };

          // Add www variant if requested
          if (canAddWww(values.domain) && values.addWww) {
            const wwwDomainId = generateUuid();
            configUpdate[`domains.trustedDomains.${wwwDomainId}`] = {
              baseUrl: wwwBaseUrl,
              handlerPath: values.handlerPath,
            };
          }

          // Domains are environment-level (contain URLs that may differ per environment)
          await updateConfig({
            adminApp: stackAdminApp,
            configUpdate,
            pushable: false,
          });
        } else {
          // Update existing domain
          await updateConfig({
            adminApp: stackAdminApp,
            configUpdate: {
              [`domains.trustedDomains.${props.editId}`]: {
                baseUrl,
                handlerPath: values.handlerPath,
              },
            },
            pushable: false,
          });
        }
      } catch (error) {
        // this piece of code fails a lot, so let's add some additional information to the error
        // TODO: remove this error once we're confident this is no longer happening
        throw new StackAssertionError(
          `Failed to update domains: ${error}`,
          {
            cause: error,
            props,
            values,
          },
        );
      }
    }}
    render={(form) => (
      <>
        <Alert>
          <div className="space-y-2">
            <p>Please ensure you own or have control over this domain. Also note that each subdomain (e.g. blog.example.com, app.example.com) is treated as a distinct domain.</p>
            <p><strong>Wildcard domains:</strong> You can use wildcards to match multiple domains:</p>
            <ul className="list-disc list-inside ml-2 space-y-1">
              <li><code>*.example.com</code> - matches any single subdomain (e.g., api.example.com, www.example.com)</li>
              <li><code>**.example.com</code> - matches any subdomain level (e.g., api.v2.example.com)</li>
              <li><code>api-*.example.com</code> - matches api-v1.example.com, api-prod.example.com, etc.</li>
              <li><code>*.*.org</code> - matches mail.example.org, but not example.org</li>
            </ul>
          </div>
        </Alert>
        <InputField
          label="Domain"
          name="domain"
          control={form.control}
          prefixItem={form.getValues('insecureHttp') ? 'http://' : 'https://'}
          placeholder='example.com'
        />

        {props.type === 'create' &&
          canAddWww(form.watch('domain')) && (
          <SwitchField
            label={`Also add www.${form.watch('domain') as any ?? ''} as a trusted domain`}
            name="addWww"
            control={form.control}
          />
        )}

        <Accordion type="single" collapsible className="w-full">
          <AccordionItem value="item-1">
            <AccordionTrigger>Advanced</AccordionTrigger>
            <AccordionContent className="flex flex-col gap-8">
              <div className="flex flex-col gap-4">
                <SwitchField
                  label="Use HTTP instead of HTTPS"
                  name="insecureHttp"
                  control={form.control}
                />
                {form.watch('insecureHttp') && (
                  <Alert variant="destructive">
                    HTTP should only be allowed during development use. For production use, please use HTTPS.
                  </Alert>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <InputField
                  label="Handler path"
                  name="handlerPath"
                  control={form.control}
                  placeholder='/handler'
                />
                <Typography variant="secondary" type="footnote">
                  only modify this if you changed the default handler path in your app
                </Typography>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </>
    )}
  />;
}

function DeleteDialog(props: {
  open?: boolean,
  onOpenChange?: (open: boolean) => void,
  domainId: string,
  baseUrl: string,
}) {
  const stackAdminApp = useAdminApp();
  const updateConfig = useUpdateConfig();

  return (
    <ActionDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title="Delete domain"
      danger
      okButton={{
        label: "Delete",
        onClick: async () => {
          await updateConfig({
            adminApp: stackAdminApp,
            configUpdate: {
              [`domains.trustedDomains.${props.domainId}`]: null,
            },
            pushable: false,
          });
        }
      }}
      cancelButton
    >
      <Typography>
        Do you really want to remove <b>{props.baseUrl}</b> from the allow list? Your project will no longer be able to receive callbacks from this domain.
      </Typography>
    </ActionDialog>
  );
}

function ActionMenu(props: {
  domains: DomainEntry[],
  domain: DomainEntry,
}) {
  const [isDeleteModalOpen, setIsDeleteModalOpen] = React.useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = React.useState(false);

  return (
    <>
      <EditDialog
        open={isEditModalOpen}
        onOpenChange={setIsEditModalOpen}
        domains={props.domains}
        type="update"
        editId={props.domain.id}
        defaultDomain={props.domain.baseUrl}
        defaultHandlerPath={props.domain.handlerPath}
      />
      <DeleteDialog
        open={isDeleteModalOpen}
        onOpenChange={setIsDeleteModalOpen}
        domainId={props.domain.id}
        baseUrl={props.domain.baseUrl}
      />
      <ActionCell
        items={[
          { item: "Edit", onClick: () => setIsEditModalOpen(true) },
          '-',
          { item: "Delete", onClick: () => setIsDeleteModalOpen(true), danger: true }
        ]}
      />
    </>
  );
}

export default function PageClient() {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const config = project.useConfig();
  const updateConfig = useUpdateConfig();

  // Local state for localhost setting
  const [localAllowLocalhost, setLocalAllowLocalhost] = useState<boolean | undefined>(undefined);
  const allowLocalhost = localAllowLocalhost ?? config.domains.allowLocalhost;
  const hasLocalhostChanges = localAllowLocalhost !== undefined;

  const handleLocalhostSave = async () => {
    if (localAllowLocalhost !== undefined) {
      await updateConfig({
        adminApp: stackAdminApp,
        configUpdate: {
          'domains.allowLocalhost': localAllowLocalhost,
        },
        pushable: true,
      });
    }
    setLocalAllowLocalhost(undefined);
  };

  const handleLocalhostDiscard = () => {
    setLocalAllowLocalhost(undefined);
  };

  // Convert config domains to array format for display
  const domains: DomainEntry[] = typedEntries(config.domains.trustedDomains)
    .filter(([, domain]) => domain.baseUrl !== undefined)
    .map(([id, domain]) => ({
      id,
      baseUrl: domain.baseUrl!,
      handlerPath: domain.handlerPath,
    }));

  return (
    <AppEnabledGuard appId="authentication">
      <PageLayout title="Domains">
        <SettingCard
          title="Trusted domains"
          description="Features that will redirect to your app, such as SSO and e-mail verification, will refuse to redirect to domains other than the ones listed here. Please make sure that you trust all domains listed here, as they can be used to access user data."
          actions={
            <EditDialog
              trigger={<Button>Add new domain</Button>}
              domains={domains}
              type="create"
            />
          }
        >
          {domains.length > 0 ? (
            <div className="border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[200px]">Domain</TableHead>
                    <TableHead>&nbsp;</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {domains.map((domain) => (
                    <TableRow key={domain.id}>
                      <TableCell>{domain.baseUrl}</TableCell>
                      <TableCell className="flex justify-end gap-4">
                        <ActionMenu
                          domains={domains}
                          domain={domain}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <Alert>
              No domains added yet.
            </Alert>
          )}
        </SettingCard>

        <SettingCard title="Development settings">
          <SettingSwitch
            checked={allowLocalhost}
            onCheckedChange={(checked) => {
              if (checked === config.domains.allowLocalhost) {
                setLocalAllowLocalhost(undefined);
              } else {
                setLocalAllowLocalhost(checked);
              }
            }}
            label="Allow all localhost callbacks for development"
            hint={<>
              When enabled, allow access from all localhost URLs by default. This makes development easier but <b>should be disabled in production.</b>
            </>}
          />
          <InlineSaveDiscard
            hasChanges={hasLocalhostChanges}
            onSave={handleLocalhostSave}
            onDiscard={handleLocalhostDiscard}
          />
        </SettingCard>
      </PageLayout>
    </AppEnabledGuard>
  );
}
