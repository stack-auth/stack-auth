"use client";
import { FormDialog } from "@/components/form-dialog";
import { InputField, SwitchField } from "@/components/form-fields";
import { SettingCard, SettingSwitch } from "@/components/settings";
import { AdminDomainConfig, AdminProject } from "@stackframe/stack";
import { yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { isValidHostnameWithWildcards, isValidUrl } from "@stackframe/stack-shared/dist/utils/urls";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger, ActionCell, ActionDialog, Alert, Button, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Typography } from "@stackframe/stack-ui";
import { useTranslations } from 'next-intl';
import React from "react";
import * as yup from "yup";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";

function EditDialog(props: {
  open?: boolean,
  onOpenChange?: (open: boolean) => void,
  trigger?: React.ReactNode,
  domains: AdminDomainConfig[],
  project: AdminProject,
  type: 'update' | 'create',
} & (
  {
    type: 'create',
  } |
  {
    type: 'update',
    editIndex: number,
    defaultDomain: string,
    defaultHandlerPath: string,
  }
)) {
  const t = useTranslations('domains');

  const domainFormSchema = yup.object({
    domain: yupString()
      .test({
        name: 'domain',
        message: (params) => t('editDialog.validation.invalidDomain'),
        test: (value) => value == null || isValidHostnameWithWildcards(value)
      })
      .test({
        name: 'unique-domain',
        message: t('editDialog.validation.domainExists'),
        test: function(value) {
          if (!value) return true;
          const { addWww, insecureHttp } = this.parent;

          // Get all existing domains except the one being edited
          const existingDomains = props.domains
            .filter((_, i) => (props.type === 'update' && i !== props.editIndex) || props.type === 'create')
            .map(({ domain }) => domain);

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
      .matches(/^\//, t('editDialog.validation.handlerPathStart'))
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
    title={t(`editDialog.title.${props.type}`)}
    formSchema={domainFormSchema}
    okButton={{ label: t(`editDialog.button.${props.type}`) }}
    onSubmit={async (values) => {
      const newDomains = [
        ...props.domains,
        {
          domain: (values.insecureHttp ? 'http' : 'https') + `://` + values.domain,
          handlerPath: values.handlerPath,
        },
        ...(canAddWww(values.domain) && values.addWww ? [{
          domain: `${values.insecureHttp ? 'http' : 'https'}://www.` + values.domain,
          handlerPath: values.handlerPath,
        }] : []),
      ];
      try {
        if (props.type === 'create') {
          await props.project.update({
            config: {
              domains: newDomains,
            },
          });
        } else {
          await props.project.update({
            config: {
              domains: [...props.domains].map((domain, i) => {
                if (i === props.editIndex) {
                  return {
                    domain: (values.insecureHttp ? 'http://' : 'https://') + values.domain,
                    handlerPath: values.handlerPath,
                  };
                }
                return domain;
              })
            },
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
            newDomains,
          },
        );
      }
    }}
    render={(form) => (
      <>
        <Alert>
          <div className="space-y-2">
            <p>{t('editDialog.alert.ownership')}</p>
            <p><strong>{t('editDialog.alert.wildcardTitle')}</strong> {t('editDialog.alert.wildcardDesc')}</p>
            <ul className="list-disc list-inside ml-2 space-y-1">
              <li><code>*.example.com</code> - {t('editDialog.alert.wildcard1')}</li>
              <li><code>**.example.com</code> - {t('editDialog.alert.wildcard2')}</li>
              <li><code>api-*.example.com</code> - {t('editDialog.alert.wildcard3')}</li>
              <li><code>*.*.org</code> - {t('editDialog.alert.wildcard4')}</li>
            </ul>
          </div>
        </Alert>
        <InputField
          label={t('editDialog.field.domainLabel')}
          name="domain"
          control={form.control}
          prefixItem={form.getValues('insecureHttp') ? 'http://' : 'https://'}
          placeholder='example.com'
        />

        {props.type === 'create' &&
          canAddWww(form.watch('domain')) && (
          <SwitchField
            label={t('editDialog.field.addWwwLabel', { domain: form.watch('domain') ?? '' })}
            name="addWww"
            control={form.control}
          />
        )}

        <Accordion type="single" collapsible className="w-full">
          <AccordionItem value="item-1">
            <AccordionTrigger>{t('editDialog.advanced.title')}</AccordionTrigger>
            <AccordionContent className="flex flex-col gap-8">
              <div className="flex flex-col gap-4">
                <SwitchField
                  label={t('editDialog.advanced.useHttp')}
                  name="insecureHttp"
                  control={form.control}
                />
                {form.watch('insecureHttp') && (
                  <Alert variant="destructive">
                    {t('editDialog.advanced.httpWarning')}
                  </Alert>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <InputField
                  label={t('editDialog.advanced.handlerPathLabel')}
                  name="handlerPath"
                  control={form.control}
                  placeholder='/handler'
                />
                <Typography variant="secondary" type="footnote">
                  {t('editDialog.advanced.handlerPathHint')}
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
  domain: string,
  project: AdminProject,
}) {
  const t = useTranslations('domains');

  return (
    <ActionDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('deleteDialog.title')}
      danger
      okButton={{
        label: t('deleteDialog.button'),
        onClick: async () => {
          await props.project.update({
            config: {
              domains: [...props.project.config.domains].filter(({ domain }) => domain !== props.domain),
            }
          });
        }
      }}
      cancelButton
    >
      <Typography>
        {t('deleteDialog.message', { domain: props.domain })}
      </Typography>
    </ActionDialog>
  );
}

function ActionMenu(props: {
  domains: AdminDomainConfig[],
  project: AdminProject,
  editIndex: number,
  targetDomain: string,
  defaultHandlerPath: string,
}) {
  const t = useTranslations('domains');
  const [isDeleteModalOpen, setIsDeleteModalOpen] = React.useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = React.useState(false);

  return (
    <>
      <EditDialog
        open={isEditModalOpen}
        onOpenChange={setIsEditModalOpen}
        domains={props.domains}
        project={props.project}
        type="update"
        editIndex={props.editIndex}
        defaultDomain={props.targetDomain}
        defaultHandlerPath={props.defaultHandlerPath}
      />
      <DeleteDialog
        open={isDeleteModalOpen}
        onOpenChange={setIsDeleteModalOpen}
        domain={props.targetDomain}
        project={props.project}
      />
      <ActionCell
        items={[
          { item: t('actionMenu.edit'), onClick: () => setIsEditModalOpen(true) },
          '-',
          { item: t('actionMenu.delete'), onClick: () => setIsDeleteModalOpen(true), danger: true }
        ]}
      />
    </>
  );
}

export default function PageClient() {
  const t = useTranslations('domains');
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const domains = project.config.domains;


  return (
    <PageLayout title={t('title')}>
      <SettingCard
        title={t('trustedDomains.title')}
        description={t('trustedDomains.description')}
        actions={
          <EditDialog
            trigger={<Button>{t('trustedDomains.addButton')}</Button>}
            domains={domains}
            project={project}
            type="create"
          />
        }
      >
        {domains.length > 0 ? (
          <div className="border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[200px]">{t('trustedDomains.table.domain')}</TableHead>
                  <TableHead>&nbsp;</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {domains.map(({ domain, handlerPath }, i) => (
                  <TableRow key={domain}>
                    <TableCell>{domain}</TableCell>
                    <TableCell className="flex justify-end gap-4">
                      <ActionMenu
                        domains={domains}
                        project={project}
                        editIndex={i}
                        targetDomain={domain}
                        defaultHandlerPath={handlerPath}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <Alert>
            {t('trustedDomains.emptyState')}
          </Alert>
        )}
      </SettingCard>

      <SettingCard title={t('devSettings.title')}>
        <SettingSwitch
          checked={project.config.allowLocalhost}
          onCheckedChange={async (checked) => {
            await project.update({
              config: { allowLocalhost: checked },
            });
          }}
          label={t('devSettings.localhostLabel')}
          hint={
            <>{t('devSettings.localhostHint')} <b>{t('devSettings.localhostWarning')}</b></>
          }
        />
      </SettingCard>
    </PageLayout>
  );
}
