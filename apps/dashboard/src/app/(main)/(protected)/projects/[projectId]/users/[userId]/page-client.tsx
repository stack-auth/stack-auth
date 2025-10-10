"use client";

import { EditableInput } from "@/components/editable-input";
import { FormDialog, SmartFormDialog } from "@/components/form-dialog";
import { InputField, SelectField } from "@/components/form-fields";
import { SettingCard } from "@/components/settings";
import { DeleteUserDialog, ImpersonateUserDialog } from "@/components/user-dialogs";
import { useThemeWatcher } from '@/lib/theme';
import MonacoEditor from '@monaco-editor/react';
import { ServerContactChannel, ServerOAuthProvider, ServerUser } from "@stackframe/stack";
import { KnownErrors } from "@stackframe/stack-shared";
import { fromNow } from "@stackframe/stack-shared/dist/utils/dates";
import { StackAssertionError } from '@stackframe/stack-shared/dist/utils/errors';
import { isJsonSerializable } from "@stackframe/stack-shared/dist/utils/json";
import { deindent } from "@stackframe/stack-shared/dist/utils/strings";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  ActionCell,
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Separator,
  SimpleTooltip,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Typography,
  cn,
  useToast
} from "@stackframe/stack-ui";
import { AtSign, Calendar, Check, Hash, Mail, MoreHorizontal, Shield, SquareAsterisk, X } from "lucide-react";
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from "react";
import * as yup from "yup";
import { PageLayout } from "../../page-layout";
import { useAdminApp } from "../../use-admin-app";

type UserInfoProps = {
  icon: React.ReactNode,
  children: React.ReactNode,
  name: string,
}

function UserInfo({ icon, name, children }: UserInfoProps) {
  return (
    <>
      <span className="flex gap-2 items-center">
        <span className="opacity-75">{icon}</span>
        <span className="font-semibold whitespace-nowrap mr-2">{name}</span>
      </span>
      {children}
    </>
  );
}

type MetadataEditorProps = {
  title: string,
  initialValue: string,
  hint: string,
  onUpdate?: (value: any) => Promise<void>,
}
function MetadataEditor({ title, initialValue, onUpdate, hint }: MetadataEditorProps) {
  const t = useTranslations('userDetail.metadata');
  const formatJson = (json: string) => JSON.stringify(JSON.parse(json), null, 2);
  const [hasChanged, setHasChanged] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  const { mounted, theme } = useThemeWatcher();

  const [value, setValue] = useState(formatJson(initialValue));
  const isJson = useMemo(() => {
    return isJsonSerializable(value);
  }, [value]);

  // Ensure proper mounting lifecycle
  useEffect(() => {
    setIsMounted(true);
    return () => {
      setIsMounted(false);
    };
  }, []);

  const handleSave = async () => {
    if (isJson) {
      const formatted = formatJson(value);
      setValue(formatted);
      await onUpdate?.(JSON.parse(formatted));
      setHasChanged(false);
    }
  };

  // Only render Monaco when both mounted states are true
  const shouldRenderMonaco = mounted && isMounted;

  return <div className="flex flex-col">
    <h3 className='text-sm mb-4 font-semibold'>
      {title}
      <SimpleTooltip tooltip={hint} type="info" inline className="ml-2 mb-[2px]" />
    </h3>
    {shouldRenderMonaco ? (
      <div className={cn("rounded-md overflow-hidden", theme !== 'dark' && "border")}>
        <MonacoEditor
          key={`monaco-${theme}`} // Force recreation on theme change
          height="240px"
          defaultLanguage="json"
          value={value}
          onChange={(x) => {
            setValue(x ?? '');
            setHasChanged(true);
          }}
          theme={theme === 'dark' ? 'vs-dark' : 'vs'}
          options={{
            tabSize: 2,
            minimap: {
              enabled: false,
            },
            scrollBeyondLastLine: false,
            overviewRulerLanes: 0,
            lineNumbersMinChars: 3,
            showFoldingControls: 'never',
          }}
        />
      </div>
    ) : (
      <div className={cn("rounded-md overflow-hidden h-[240px] flex items-center justify-center", theme !== 'dark' && "border")}>
        <div className="text-sm text-muted-foreground">{t('loadingEditor')}</div>
      </div>
    )}
    <div className={cn('self-end flex items-end gap-2 transition-all h-0 opacity-0 overflow-hidden', hasChanged && 'h-[48px] opacity-100')}>
      <Button
        variant="ghost"
        onClick={() => {
          setValue(formatJson(initialValue));
          setHasChanged(false);
        }}>
        {t('revert')}
      </Button>
      <Button
        variant={isJson ? "default" : "secondary"}
        disabled={!isJson}
        onClick={handleSave}>{t('save')}</Button>
    </div>
  </div>;
}

export default function PageClient({ userId }: { userId: string }) {
  const t = useTranslations('userDetail');
  const stackAdminApp = useAdminApp();
  const user = stackAdminApp.useUser(userId);

  if (user === null) {
    return <PageLayout
      title={t('notFound')}
    >
      {t('notFound')}
    </PageLayout>;
  }

  return <UserPage user={user}/>;
}

type UserHeaderProps = {
  user: ServerUser,
};

function UserHeader({ user }: UserHeaderProps) {
  const t = useTranslations('userDetail');
  const nameFallback = user.primaryEmail ?? user.id;
  const name = user.displayName ?? nameFallback;
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [impersonateSnippet, setImpersonateSnippet] = useState<string | null>(null);
  const stackAdminApp = useAdminApp();

  return (
    <div className="flex gap-4 items-center">
      <Avatar className="w-20 h-20">
        <AvatarImage src={user.profileImageUrl ?? undefined} alt={name} />
        <AvatarFallback>{name.slice(0, 2)}</AvatarFallback>
      </Avatar>
      <div className="flex-grow">
        <EditableInput
          value={name}
          initialEditValue={user.displayName ?? ""}
          placeholder={nameFallback}
          shiftTextToLeft
          inputClassName="font-semibold text-3xl"
          onUpdate={async (newName) => {
            await user.setDisplayName(newName);
          }}/>
        <p>{t('lastActive')} {fromNow(user.lastActiveAt)}</p>
      </div>
      <div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon">
              <MoreHorizontal className="h-5 w-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={async () => {
              const expiresInMillis = 1000 * 60 * 60 * 2;
              const expiresAtDate = new Date(Date.now() + expiresInMillis);
              const session = await user.createSession({ expiresInMillis });
              const tokens = await session.getTokens();
              setImpersonateSnippet(deindent`
                document.cookie = 'stack-refresh-${stackAdminApp.projectId}=${tokens.refreshToken}; expires=${expiresAtDate.toUTCString()}; path=/'; 
                window.location.reload();
              `);
            }}>
              <span>{t('actions.impersonate')}</span>
            </DropdownMenuItem>
            {user.isMultiFactorRequired && (
              <DropdownMenuItem onClick={async () => {
                await user.update({ totpMultiFactorSecret: null });
              }}>
                <span>{t('actions.remove2FA')}</span>
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setIsDeleteModalOpen(true)}>
              <Typography className="text-destructive">{t('actions.delete')}</Typography>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <DeleteUserDialog user={user} open={isDeleteModalOpen} onOpenChange={setIsDeleteModalOpen} redirectTo={`/projects/${stackAdminApp.projectId}/users`} />
        <ImpersonateUserDialog user={user} impersonateSnippet={impersonateSnippet} onClose={() => setImpersonateSnippet(null)} />
      </div>
    </div>
  );
}

type UserDetailsProps = {
  user: ServerUser,
};

function UserDetails({ user }: UserDetailsProps) {
  const t = useTranslations('userDetail.fields');
  const [newPassword, setNewPassword] = useState<string | null>(null);
  return (
    <div className="grid grid-cols-[min-content_1fr] lg:grid-cols-[min-content_1fr_min-content_1fr] gap-2 text-sm px-4">
      <UserInfo icon={<Hash size={16}/>} name={t('userId')}>
        <EditableInput value={user.id} readOnly />
      </UserInfo>
      <UserInfo icon={<Mail size={16}/>} name={t('primaryEmail')}>
        <EditableInput value={user.primaryEmail ?? ""} placeholder={"-"} readOnly/>
      </UserInfo>
      <UserInfo icon={<AtSign size={16}/>} name={t('displayName')}>
        <EditableInput value={user.displayName ?? ""} placeholder={"-"} onUpdate={async (newName) => {
          await user.setDisplayName(newName);
        }}/>
      </UserInfo>
      <UserInfo icon={<SquareAsterisk size={16}/>} name={t('password')}>
        <EditableInput
          value={""}
          placeholder={user.hasPassword ? "************" : "-"}
          mode="password"
          onUpdate={async (newPassword) => {
            await user.setPassword({ password: newPassword });
          }}
        />
      </UserInfo>
      <UserInfo icon={<Shield size={16}/>} name={t('twoFactorAuth')}>
        <EditableInput value={user.isMultiFactorRequired ? t('enabled') : ''} placeholder={t('disabled')} readOnly />
      </UserInfo>
      <UserInfo icon={<Calendar size={16}/>} name={t('signedUpAt')}>
        <EditableInput value={user.signedUpAt.toDateString()} readOnly />
      </UserInfo>
    </div>
  );
}

type ContactChannelsSectionProps = {
  user: ServerUser,
};

type AddEmailDialogProps = {
  user: ServerUser,
  open: boolean,
  onOpenChange: (open: boolean) => void,
};

function AddEmailDialog({ user, open, onOpenChange }: AddEmailDialogProps) {
  const t = useTranslations('userDetail.contactChannels.addDialog');
  const formSchema = yup.object({
    email: yup.string()
      .email("Please enter a valid e-mail address")
      .defined("E-mail is required")
      .label(t('fields.email'))
      .meta({
        stackFormFieldPlaceholder: t('fields.emailPlaceholder'),
      }),
    isVerified: yup.boolean()
      .default(false)
      .label(t('fields.isVerified'))
      .meta({
        description: t('hints.isVerified')
      }),
    isPrimary: yup.boolean()
      .default(false)
      .label(t('fields.isPrimary'))
      .meta({
        description: t('hints.isPrimary')
      }),
    isUsedForAuth: yup.boolean()
      .default(false)
      .label(t('fields.isUsedForAuth'))
      .meta({
        description: t('hints.isUsedForAuth')
      }),
  });

  return (
    <SmartFormDialog
      title={t('title')}
      description={t('description')}
      open={open}
      onOpenChange={onOpenChange}
      formSchema={formSchema}
      onSubmit={async (values) => {
        if (!values.email.trim()) return;

        await user.createContactChannel({
          type: 'email',
          value: values.email.trim(),
          isVerified: values.isVerified,
          isPrimary: values.isPrimary,
          usedForAuth: values.isUsedForAuth
        });
      }}
    />
  );
}

type SendVerificationEmailDialogProps = {
  channel: ServerContactChannel,
  open: boolean,
  onOpenChange: (open: boolean) => void,
};

type SendResetPasswordEmailDialogProps = {
  channel: ServerContactChannel,
  open: boolean,
  onOpenChange: (open: boolean) => void,
};

type SendSignInInvitationDialogProps = {
  channel: ServerContactChannel,
  open: boolean,
  onOpenChange: (open: boolean) => void,
};

type DomainSelectorProps = {
  control: any,
  watch: any,
  domains: Array<{ domain: string, handlerPath: string }>,
  allowLocalhost: boolean,
};

function DomainSelector({ control, watch, domains, allowLocalhost }: DomainSelectorProps) {
  const t = useTranslations('userDetail.contactChannels.sendEmailDialog');
  return (
    <>
      <SelectField
        control={control}
        name="selected"
        label={t('domain')}
        options={[
          ...domains.map((domain, index) => ({ value: index.toString(), label: domain.domain })),
          ...(allowLocalhost ? [{ value: "localhost", label: "localhost" }] : [])
        ]}
      />
      {watch("selected") === "localhost" && (
        <>
          <InputField
            control={control}
            name="localhostPort"
            label={t('localhostPort')}
            placeholder="3000"
            type="number"
          />
          <Accordion type="single" collapsible className="w-full">
            <AccordionItem value="item-1">
              <AccordionTrigger>{t('advanced')}</AccordionTrigger>
              <AccordionContent className="flex flex-col gap-8">
                <div className="flex flex-col gap-2">
                  <InputField
                    label={t('handlerPath')}
                    name="handlerPath"
                    control={control}
                    placeholder='/handler'
                  />
                  <Typography variant="secondary" type="footnote">
                    {t('handlerPathHint')}
                  </Typography>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </>
      )}
    </>
  );
}

type SendEmailWithDomainDialogProps = {
  title: string,
  description: string,
  open: boolean,
  onOpenChange: (open: boolean) => void,
  endpointPath: string,
  onSubmit: (callbackUrl: string) => Promise<void>,
};

function SendEmailWithDomainDialog({
  title,
  description,
  open,
  onOpenChange,
  endpointPath,
  onSubmit
}: SendEmailWithDomainDialogProps) {
  const t = useTranslations('userDetail.contactChannels.sendEmailDialog');
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const domains = project.config.domains;

  return (
    <FormDialog
      title={title}
      description={description}
      open={open}
      onOpenChange={onOpenChange}
      formSchema={yup.object({
        selected: yup.string().defined(),
        localhostPort: yup.number().test("required-if-localhost", "Required if localhost is selected", (value, context) => {
          return context.parent.selected === "localhost" ? value !== undefined : true;
        }),
        handlerPath: yup.string().optional(),
      })}
      okButton={{
        label: t('send'),
      }}
      render={({ control, watch }) => (
        <DomainSelector
          control={control}
          watch={watch}
          domains={domains}
          allowLocalhost={project.config.allowLocalhost}
        />
      )}
      onSubmit={async (values) => {
        let baseUrl: string;
        let handlerPath: string;
        if (values.selected === "localhost") {
          baseUrl = `http://localhost:${values.localhostPort}`;
          handlerPath = values.handlerPath || '/handler';
        } else {
          const domain = domains[parseInt(values.selected)];
          baseUrl = domain.domain;
          handlerPath = domain.handlerPath;
        }
        const callbackUrl = new URL(handlerPath.replace(/\/?$/, '/') + endpointPath.replace(/^\//, ''), baseUrl).toString();
        await onSubmit(callbackUrl);
      }}
    />
  );
}

function SendVerificationEmailDialog({ channel, open, onOpenChange }: SendVerificationEmailDialogProps) {
  const t = useTranslations('userDetail.contactChannels.sendEmailDialog.verification');
  return (
    <SendEmailWithDomainDialog
      title={t('title')}
      description={t('description', { email: channel.value })}
      open={open}
      onOpenChange={onOpenChange}
      endpointPath="/email-verification"
      onSubmit={async (callbackUrl) => {
        await channel.sendVerificationEmail({ callbackUrl });
      }}
    />
  );
}

function SendResetPasswordEmailDialog({ channel, open, onOpenChange }: SendResetPasswordEmailDialogProps) {
  const t = useTranslations('userDetail.contactChannels.sendEmailDialog.resetPassword');
  const stackAdminApp = useAdminApp();

  return (
    <SendEmailWithDomainDialog
      title={t('title')}
      description={t('description', { email: channel.value })}
      open={open}
      onOpenChange={onOpenChange}
      endpointPath="/password-reset"
      onSubmit={async (callbackUrl) => {
        await stackAdminApp.sendForgotPasswordEmail(channel.value, { callbackUrl });
      }}
    />
  );
}

function SendSignInInvitationDialog({ channel, open, onOpenChange }: SendSignInInvitationDialogProps) {
  const t = useTranslations('userDetail.contactChannels.sendEmailDialog.signInInvitation');
  const stackAdminApp = useAdminApp();

  return (
    <SendEmailWithDomainDialog
      title={t('title')}
      description={t('description', { email: channel.value })}
      open={open}
      onOpenChange={onOpenChange}
      endpointPath="/sign-in"
      onSubmit={async (callbackUrl) => {
        await stackAdminApp.sendSignInInvitationEmail(channel.value, callbackUrl);
      }}
    />
  );
}

function ContactChannelsSection({ user }: ContactChannelsSectionProps) {
  const t = useTranslations('userDetail.contactChannels');
  const tActions = useTranslations('userDetail.contactChannels.actions');
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const contactChannels = user.useContactChannels();
  const [isAddEmailDialogOpen, setIsAddEmailDialogOpen] = useState(false);
  const [sendVerificationEmailDialog, setSendVerificationEmailDialog] = useState<{
    channel: ServerContactChannel,
    isOpen: boolean,
  } | null>(null);
  const [sendResetPasswordEmailDialog, setSendResetPasswordEmailDialog] = useState<{
    channel: ServerContactChannel,
    isOpen: boolean,
  } | null>(null);
  const [sendSignInInvitationDialog, setSendSignInInvitationDialog] = useState<{
    channel: ServerContactChannel,
    isOpen: boolean,
  } | null>(null);

  const toggleUsedForAuth = async (channel: ServerContactChannel) => {
    await channel.update({ usedForAuth: !channel.usedForAuth });
  };

  const toggleVerified = async (channel: ServerContactChannel) => {
    await channel.update({ isVerified: !channel.isVerified });
  };

  const setPrimaryEmail = async (channel: ServerContactChannel) => {
    await channel.update({ isPrimary: true });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{t('title')}</h2>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setIsAddEmailDialogOpen(true)}
        >
          {t('addEmail')}
        </Button>
      </div>

      <AddEmailDialog
        user={user}
        open={isAddEmailDialogOpen}
        onOpenChange={setIsAddEmailDialogOpen}
      />

      {sendVerificationEmailDialog && (
        <SendVerificationEmailDialog
          channel={sendVerificationEmailDialog.channel}
          open={sendVerificationEmailDialog.isOpen}
          onOpenChange={(open) => {
            if (!open) {
              setSendVerificationEmailDialog(null);
            }
          }}
        />
      )}

      {sendResetPasswordEmailDialog && (
        <SendResetPasswordEmailDialog
          channel={sendResetPasswordEmailDialog.channel}
          open={sendResetPasswordEmailDialog.isOpen}
          onOpenChange={(open) => {
            if (!open) {
              setSendResetPasswordEmailDialog(null);
            }
          }}
        />
      )}

      {sendSignInInvitationDialog && (
        <SendSignInInvitationDialog
          channel={sendSignInInvitationDialog.channel}
          open={sendSignInInvitationDialog.isOpen}
          onOpenChange={(open) => {
            if (!open) {
              setSendSignInInvitationDialog(null);
            }
          }}
        />
      )}

      {contactChannels.length === 0 ? (
        <div className="flex flex-col items-center gap-2 p-4 border rounded-md bg-muted/10">
          <p className='text-sm text-gray-500 text-center'>
            {t('noChannels')}
          </p>
        </div>
      ) : (
        <div className='border rounded-md'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('table.email')}</TableHead>
                <TableHead className="text-center">{t('table.primary')}</TableHead>
                <TableHead className="text-center">{t('table.verified')}</TableHead>
                <TableHead className="text-center">{t('table.usedForSignIn')}</TableHead>
                <TableHead className="w-[80px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contactChannels.map((channel) => (
                <TableRow key={channel.id}>
                  <TableCell>
                    <div className='flex flex-col md:flex-row gap-2 md:gap-4'>
                      {channel.value}
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    {channel.isPrimary ? <Check className="mx-auto h-4 w-4 text-green-500" /> : null}
                  </TableCell>
                  <TableCell className="text-center">
                    {channel.isVerified ?
                      <Check className="mx-auto h-4 w-4 text-green-500" /> :
                      <X className="mx-auto h-4 w-4 text-muted-foreground" />
                    }
                  </TableCell>
                  <TableCell className="text-center">
                    {channel.usedForAuth ?
                      <Check className="mx-auto h-4 w-4 text-green-500" /> :
                      <X className="mx-auto h-4 w-4 text-muted-foreground" />
                    }
                  </TableCell>
                  <TableCell align="right">
                    <ActionCell
                      items={[
                        {
                          item: tActions('sendSignInInvitation'),
                          onClick: async () => {
                            setSendSignInInvitationDialog({
                              channel,
                              isOpen: true,
                            });
                          },
                        },
                        ...(!channel.isVerified ? [{
                          item: tActions('sendVerificationEmail'),
                          onClick: async () => {
                            setSendVerificationEmailDialog({
                              channel,
                              isOpen: true,
                            });
                          },
                        }] : []),
                        ...(project.config.credentialEnabled ? [{
                          item: tActions('sendResetPasswordEmail'),
                          onClick: async () => {
                            setSendResetPasswordEmailDialog({
                              channel,
                              isOpen: true,
                            });
                          },
                        }] : []),
                        {
                          item: channel.isVerified ? tActions('markAsUnverified') : tActions('markAsVerified'),
                          onClick: async () => {
                            await toggleVerified(channel);
                          },
                        },
                        ...(!channel.isPrimary ? [{
                          item: tActions('setAsPrimary'),
                          onClick: async () => {
                            await setPrimaryEmail(channel);
                          },
                        }] : []),
                        {
                          item: channel.usedForAuth ? tActions('disableForSignIn') : tActions('enableForSignIn'),
                          onClick: async () => {
                            await toggleUsedForAuth(channel);
                          },
                        },
                        {
                          item: tActions('delete'),
                          danger: true,
                          onClick: async () => {
                            await channel.delete();
                          },
                        }
                      ]}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

type UserTeamsSectionProps = {
  user: ServerUser,
};

function UserTeamsSection({ user }: UserTeamsSectionProps) {
  const t = useTranslations('userDetail.teams');
  const tActions = useTranslations('userDetail.teams.actions');
  const stackAdminApp = useAdminApp();
  const teams = user.useTeams();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{t('title')}</h2>
          <p className="text-sm text-muted-foreground">{t('description')}</p>
        </div>
      </div>

      {teams.length === 0 ? (
        <div className="flex flex-col items-center gap-2 p-4 border rounded-md bg-muted/10">
          <p className='text-sm text-gray-500 text-center'>
            {t('noTeams')}
          </p>
        </div>
      ) : (
        <div className='border rounded-md'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('table.teamId')}</TableHead>
                <TableHead>{t('table.displayName')}</TableHead>
                <TableHead>{t('table.createdAt')}</TableHead>
                <TableHead className="w-[80px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {teams.map((team) => (
                <TableRow key={team.id}>
                  <TableCell>
                    <div className="font-mono text-xs bg-muted px-2 py-1 rounded max-w-[120px] truncate">
                      {team.id}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">
                      {team.displayName || '-'}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm text-muted-foreground">
                      {team.createdAt.toLocaleDateString()}
                    </div>
                  </TableCell>
                  <TableCell align="right">
                    <ActionCell
                      items={[
                        {
                          item: tActions('viewTeam'),
                          onClick: () => {
                            window.open(`/projects/${stackAdminApp.projectId}/teams/${team.id}`, '_blank', 'noopener');
                          },
                        },
                      ]}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

type OAuthProvidersSectionProps = {
  user: ServerUser,
};

type OAuthProviderDialogProps = {
  user: ServerUser,
  open: boolean,
  onOpenChange: (open: boolean) => void,
} & ({
  mode: 'create',
} | {
  mode: 'edit',
  provider: ServerOAuthProvider,
});

function OAuthProviderDialog(props: OAuthProviderDialogProps) {
  const t = useTranslations('userDetail.oauthProviders.dialog');
  const tFields = useTranslations('userDetail.oauthProviders.dialog.fields');
  const tErrors = useTranslations('userDetail.oauthProviders.dialog.errors');
  const tSuccess = useTranslations('userDetail.oauthProviders.dialog.success');
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const { toast } = useToast();

  // Get available OAuth providers from project config
  const availableProviders = project.config.oauthProviders;
  const isEditMode = props.mode === 'edit';
  const provider = isEditMode ? props.provider : null;

  const formSchema = yup.object({
    providerId: yup.string()
      .defined("Provider is required")
      .nonEmpty("Provider is required")
      .label(tFields('provider'))
      .meta({
        stackFormFieldRender: (innerProps: { control: any, name: string, label: string, disabled: boolean }) => (
          <SelectField
            control={innerProps.control}
            name={innerProps.name}
            label={innerProps.label}
            disabled={innerProps.disabled || isEditMode} // Disable provider selection in edit mode
            options={availableProviders.map((p: any) => ({
              value: p.id,
              label: p.id.charAt(0).toUpperCase() + p.id.slice(1)
            }))}
            placeholder={tFields('providerPlaceholder')}
          />
        ),
      }),
    email: yup.string()
      .email("Please enter a valid e-mail address")
      .optional()
      .label(tFields('email'))
      .meta({
        stackFormFieldPlaceholder: tFields('emailPlaceholder'),
      }),
    accountId: yup.string()
      .defined("Account ID is required")
      .label(tFields('accountId'))
      .meta({
        stackFormFieldPlaceholder: tFields('accountIdPlaceholder'),
        description: tFields('accountIdDescription'),
        stackFormFieldExtraProps: {
          disabled: isEditMode, // Disable account ID editing in edit mode
        },
      }),
    allowSignIn: yup.boolean()
      .default(true)
      .label(tFields('allowSignIn'))
      .meta({
        description: tFields('allowSignInDescription')
      }),
    allowConnectedAccounts: yup.boolean()
      .default(true)
      .label(tFields('allowConnectedAccounts'))
      .meta({
        description: tFields('allowConnectedAccountsDescription')
      }),
  });

  // Set default values based on mode
  const defaultValues = isEditMode && provider ? {
    providerId: provider.type,
    email: provider.email,
    accountId: provider.accountId,
    allowSignIn: provider.allowSignIn,
    allowConnectedAccounts: provider.allowConnectedAccounts,
  } : {
    providerId: "",
    email: "",
    accountId: "",
    allowSignIn: true,
    allowConnectedAccounts: true,
  };

  const handleSubmit = async (values: yup.InferType<typeof formSchema>) => {
    let result;

    if (isEditMode && provider) {
      // Update existing provider
      result = await provider.update({
        email: values.email?.trim() || provider.email,
        allowSignIn: values.allowSignIn,
        allowConnectedAccounts: values.allowConnectedAccounts,
      });
    } else {
      // Create new provider
      if (!values.accountId.trim()) return;

      const providerConfig = availableProviders.find((p: any) => p.id === values.providerId);
      if (!providerConfig) {
        throw new StackAssertionError(`Provider config not found for ${values.providerId}`);
      }

      result = await stackAdminApp.createOAuthProvider({
        userId: props.user.id,
        providerConfigId: providerConfig.id,
        accountId: values.accountId.trim(),
        email: values.email?.trim() || "",
        allowSignIn: values.allowSignIn,
        allowConnectedAccounts: values.allowConnectedAccounts,
      });
    }

    // Handle errors for both create and update operations
    if (result.status === "error") {
      const providerType = isEditMode && provider ? provider.type : values.providerId;
      const accountId = isEditMode && provider ? provider.accountId : values.accountId;
      const operation = isEditMode ? "updating" : "adding";

      if (KnownErrors.OAuthProviderAccountIdAlreadyUsedForSignIn.isInstance(result.error)) {
        toast({
          title: tErrors('accountAlreadyConnected'),
          description: tErrors('accountAlreadyConnectedDescription', { provider: providerType, accountId }),
          variant: "destructive",
        });
      } else {
        console.error(result.error);
        toast({
          title: tErrors('unexpectedError'),
          description: tErrors('unexpectedErrorDescription', { operation }),
          variant: "destructive",
        });
      }
      return 'prevent-close';
    }
  };

  // Update the form schema defaults based on mode
  const schemaWithDefaults = formSchema.default(defaultValues);

  return (
    <SmartFormDialog
      title={isEditMode ? t('edit.title') : t('create.title')}
      description={isEditMode ? t('edit.description') : t('create.description')}
      open={props.open}
      onOpenChange={props.onOpenChange}
      formSchema={schemaWithDefaults}
      onSubmit={handleSubmit}
    />
  );
}

function OAuthProvidersSection({ user }: OAuthProvidersSectionProps) {
  const t = useTranslations('userDetail.oauthProviders');
  const tActions = useTranslations('userDetail.oauthProviders.actions');
  const tErrors = useTranslations('userDetail.oauthProviders.dialog.errors');
  const tSuccess = useTranslations('userDetail.oauthProviders.dialog.success');
  const oauthProviders = user.useOAuthProviders();
  const [isAddProviderDialogOpen, setIsAddProviderDialogOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<ServerOAuthProvider | null>(null);
  const { toast } = useToast();

  const handleProviderUpdate = async (provider: ServerOAuthProvider, updates: { allowSignIn?: boolean, allowConnectedAccounts?: boolean }) => {
    const result = await provider.update(updates);
    if (result.status === "error") {
      if (KnownErrors.OAuthProviderAccountIdAlreadyUsedForSignIn.isInstance(result.error)) {
        toast({
          title: tErrors('accountAlreadyConnected'),
          description: tErrors('accountAlreadyConnectedDescription', { provider: provider.type, accountId: provider.accountId }),
          variant: "destructive",
        });
      } else {
        const settingType = updates.allowSignIn !== undefined ? "sign-in" : "connected accounts";
        toast({
          title: tErrors('updateFailed'),
          description: updates.allowSignIn !== undefined ? tErrors('signInUpdateFailed') : tErrors('connectedAccountsUpdateFailed'),
          variant: "destructive",
        });
      }
    } else {
      let successMessage = "";
      if (updates.allowSignIn !== undefined) {
        successMessage = provider.allowSignIn ? tSuccess('signInDisabled', { provider: provider.type }) : tSuccess('signInEnabled', { provider: provider.type });
      } else if (updates.allowConnectedAccounts !== undefined) {
        successMessage = provider.allowConnectedAccounts ? tSuccess('connectedAccountsDisabled', { provider: provider.type }) : tSuccess('connectedAccountsEnabled', { provider: provider.type });
      }
      toast({
        title: tSuccess('title'),
        description: successMessage,
        variant: "success",
      });
    }
  };

  const toggleAllowSignIn = async (provider: ServerOAuthProvider) => {
    await handleProviderUpdate(provider, { allowSignIn: !provider.allowSignIn });
  };

  const toggleAllowConnectedAccounts = async (provider: ServerOAuthProvider) => {
    await handleProviderUpdate(provider, { allowConnectedAccounts: !provider.allowConnectedAccounts });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{t('title')}</h2>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setIsAddProviderDialogOpen(true)}
        >
          {t('addProvider')}
        </Button>
      </div>

      <OAuthProviderDialog
        user={user}
        open={isAddProviderDialogOpen}
        onOpenChange={setIsAddProviderDialogOpen}
        mode="create"
      />

      {editingProvider && (
        <OAuthProviderDialog
          user={user}
          open={!!editingProvider}
          onOpenChange={() => setEditingProvider(null)}
          mode="edit"
          provider={editingProvider}
        />
      )}

      {oauthProviders.length === 0 ? (
        <div className="flex flex-col items-center gap-2 p-4 border rounded-md bg-muted/10">
          <p className='text-sm text-gray-500 text-center'>
            {t('noProviders')}
          </p>
        </div>
      ) : (
        <div className='border rounded-md'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('table.provider')}</TableHead>
                <TableHead>{t('table.email')}</TableHead>
                <TableHead>{t('table.accountId')}</TableHead>
                <TableHead className="text-center">{t('table.usedForSignIn')}</TableHead>
                <TableHead className="text-center">{t('table.usedForConnectedAccounts')}</TableHead>
                <TableHead className="w-[80px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {oauthProviders.map((provider: ServerOAuthProvider) => (
                <TableRow key={provider.id + '-' + provider.accountId}>
                  <TableCell>
                    <div className='flex items-center gap-2'>
                      <div className="capitalize font-medium">
                        {provider.type}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className='flex flex-col md:flex-row gap-2 md:gap-4'>
                      {provider.email}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="font-mono text-xs">
                      {provider.accountId}
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    {provider.allowSignIn ?
                      <Check className="mx-auto h-4 w-4 text-green-500" /> :
                      <X className="mx-auto h-4 w-4 text-muted-foreground" />
                    }
                  </TableCell>
                  <TableCell className="text-center">
                    {provider.allowConnectedAccounts ?
                      <Check className="mx-auto h-4 w-4 text-green-500" /> :
                      <X className="mx-auto h-4 w-4 text-muted-foreground" />
                    }
                  </TableCell>
                  <TableCell align="right">
                    <ActionCell
                      items={[
                        {
                          item: tActions('edit'),
                          onClick: () => setEditingProvider(provider),
                        },
                        {
                          item: provider.allowSignIn ? tActions('disableSignIn') : tActions('enableSignIn'),
                          onClick: async () => {
                            await toggleAllowSignIn(provider);
                          },
                        },
                        {
                          item: provider.allowConnectedAccounts ? tActions('disableConnectedAccounts') : tActions('enableConnectedAccounts'),
                          onClick: async () => {
                            await toggleAllowConnectedAccounts(provider);
                          },
                        },
                        {
                          item: tActions('delete'),
                          danger: true,
                          onClick: async () => {
                            await provider.delete();
                          },
                        }
                      ]}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

type MetadataSectionProps = {
  user: ServerUser,
};

function MetadataSection({ user }: MetadataSectionProps) {
  const t = useTranslations('userDetail.metadata');
  return (
    <SettingCard
      title={t('title')}
      description={t('description')}
    >
      <div className="grid gap-4 grid-cols-1 lg:grid-cols-3">
        <MetadataEditor
          title={t('client')}
          hint={t('clientHint')}
          initialValue={JSON.stringify(user.clientMetadata)}
          onUpdate={async (value) => {
            await user.setClientMetadata(value);
          }}
        />
        <MetadataEditor
          title={t('clientReadOnly')}
          hint={t('clientReadOnlyHint')}
          initialValue={JSON.stringify(user.clientReadOnlyMetadata)}
          onUpdate={async (value) => {
            await user.setClientReadOnlyMetadata(value);
          }}
        />
        <MetadataEditor
          title={t('server')}
          hint={t('serverHint')}
          initialValue={JSON.stringify(user.serverMetadata)}
          onUpdate={async (value) => {
            await user.setServerMetadata(value);
          }}
        />
      </div>
    </SettingCard>
  );
}

function UserPage({ user }: { user: ServerUser }) {
  return (
    <PageLayout>
      <div className="flex flex-col gap-6">
        <UserHeader user={user} />
        <Separator />
        <UserDetails user={user} />
        <Separator />
        <ContactChannelsSection user={user} />
        <UserTeamsSection user={user} />
        <OAuthProvidersSection user={user} />
        <MetadataSection user={user} />
      </div>
    </PageLayout>
  );
}
