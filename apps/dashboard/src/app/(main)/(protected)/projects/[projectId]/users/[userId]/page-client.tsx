"use client";

import { CountryCodeInput } from "@/components/country-code-select";
import { DesignCard, DesignCategoryTabs, DesignDataTable, DesignEditableGrid, type DesignEditableGridItem, DesignMenu, type DesignMenuActionItem } from "@/components/design-components";
import { EditableInput } from "@/components/editable-input";
import { FormDialog, SmartFormDialog } from "@/components/form-dialog";
import { InputField, SelectField } from "@/components/form-fields";
import { MetadataSection } from "@/components/metadata-editor";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  ActionCell,
  Alert,
  AlertDescription,
  AlertTitle,
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Separator,
  Textarea,
  Typography,
  useToast
} from "@/components/ui";
import { DeleteUserDialog, ImpersonateUserDialog } from "@/components/user-dialogs";
import { parseRiskScore } from "@/lib/risk-score-utils";
import { AtIcon, CalendarIcon, CheckIcon, EnvelopeIcon, GlobeIcon, HashIcon, KeyIcon, ProhibitIcon, ShieldIcon, SquareIcon, UsersIcon, XIcon } from "@phosphor-icons/react";
import { ServerContactChannel, ServerOAuthProvider, ServerTeam, ServerUser } from "@stackframe/stack";
import { KnownErrors } from "@stackframe/stack-shared";
import { normalizeCountryCode } from "@stackframe/stack-shared/dist/schema-fields";
import { fromNow } from "@stackframe/stack-shared/dist/utils/dates";
import { captureError, StackAssertionError } from '@stackframe/stack-shared/dist/utils/errors';
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { deindent } from "@stackframe/stack-shared/dist/utils/strings";
import { ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import * as yup from "yup";
import { AppEnabledGuard } from "../../app-enabled-guard";
import { PageLayout } from "../../page-layout";
import { useAdminApp } from "../../use-admin-app";

const userMetadataDocsUrl = "https://docs.stack-auth.com/docs/concepts/custom-user-data";

export default function PageClient({ userId }: { userId: string }) {
  const stackAdminApp = useAdminApp();
  const user = stackAdminApp.useUser(userId);

  if (user === null) {
    return (
      <AppEnabledGuard appId="authentication">
        <PageLayout title="User Not Found">
          User Not Found
        </PageLayout>
      </AppEnabledGuard>
    );
  }

  return (
    <AppEnabledGuard appId="authentication">
      <UserPage user={user} />
    </AppEnabledGuard>
  );
}

type UserHeaderProps = {
  user: ServerUser,
};

function UserHeader({ user }: UserHeaderProps) {
  const nameFallback = user.primaryEmail ?? user.id;
  const name = user.displayName ?? nameFallback;
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [impersonateSnippet, setImpersonateSnippet] = useState<string | null>(null);
  const stackAdminApp = useAdminApp();

  return (
    <div className="flex min-w-0 flex-1 gap-4 items-center">
      <Avatar className="w-20 h-20 shrink-0">
        <AvatarImage src={user.profileImageUrl ?? undefined} alt={name} />
        <AvatarFallback>{name.slice(0, 2)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <EditableInput
          value={name}
          initialEditValue={user.displayName ?? ""}
          placeholder={nameFallback}
          shiftTextToLeft
          inputClassName="font-semibold text-3xl"
          onUpdate={async (newName) => {
            await user.setDisplayName(newName);
          }}/>
        <p>Last active {fromNow(user.lastActiveAt)}</p>
      </div>
      <div>
        <DesignMenu
          variant="actions"
          trigger="icon"
          triggerLabel="User actions"
          align="end"
          items={[
            {
              id: "impersonate",
              label: "Impersonate",
              onClick: async () => {
                const expiresInMillis = 1000 * 60 * 60 * 2;
                const expiresAtDate = new Date(Date.now() + expiresInMillis);
                const session = await user.createSession({ expiresInMillis });
                const tokens = await session.getTokens();
                setImpersonateSnippet(deindent`
                  document.cookie = 'stack-refresh-${stackAdminApp.projectId}=${tokens.refreshToken}; expires=${expiresAtDate.toUTCString()}; path=/'; 
                  window.location.reload();
                `);
              },
            },
            ...user.isMultiFactorRequired ? [{
              id: "remove-2fa",
              label: "Remove 2FA",
              onClick: async () => {
                await user.update({ totpMultiFactorSecret: null });
              },
            }] satisfies DesignMenuActionItem[] : [],
            {
              id: "delete",
              label: "Delete",
              itemVariant: "destructive" as const,
              onClick: () => setIsDeleteModalOpen(true),
            },
          ]}
        />
        <DeleteUserDialog user={user} open={isDeleteModalOpen} onOpenChange={setIsDeleteModalOpen} redirectTo={`/projects/${stackAdminApp.projectId}/users`} />
        <ImpersonateUserDialog user={user} impersonateSnippet={impersonateSnippet} onClose={() => setImpersonateSnippet(null)} />
      </div>
    </div>
  );
}

// Get the human-readable restriction reason
function getRestrictionReasonText(user: ServerUser): string {
  const restrictedReason = user.restrictedReason;
  if (!restrictedReason) return '';

  switch (restrictedReason.type) {
    case 'anonymous': {
      return 'Anonymous user';
    }
    case 'email_not_verified': {
      return 'Unverified email';
    }
    case 'restricted_by_administrator': {
      return 'Manually restricted';
    }
    default: {
      return 'Restricted';
    }
  }
}

// Restriction dialog for editing restriction details
function RestrictionDialog({
  user,
  open,
  onOpenChange,
}: {
  user: ServerUser,
  open: boolean,
  onOpenChange: (open: boolean) => void,
}) {
  const restrictedByAdmin = (user as any).restrictedByAdmin ?? false;
  const restrictedByAdminReason = (user as any).restrictedByAdminReason ?? null;
  const restrictedByAdminPrivateDetails = (user as any).restrictedByAdminPrivateDetails ?? null;

  const [publicReason, setPublicReason] = useState(restrictedByAdminReason ?? '');
  const [privateDetails, setPrivateDetails] = useState(restrictedByAdminPrivateDetails ?? '');
  const [isSaving, setIsSaving] = useState(false);

  // Reset form when dialog opens
  const handleOpenChange = (newOpen: boolean) => {
    if (newOpen) {
      setPublicReason(restrictedByAdminReason ?? '');
      setPrivateDetails(restrictedByAdminPrivateDetails ?? '');
    }
    onOpenChange(newOpen);
  };

  const handleSaveAndRestrict = async () => {
    if (!privateDetails.trim()) {
      alert('Please enter the private details for the restriction.');
      return;
    }

    setIsSaving(true);
    try {
      await user.update({ restrictedByAdmin: true, restrictedByAdminReason: publicReason.trim() || null, restrictedByAdminPrivateDetails: privateDetails.trim() || null } as any);
      onOpenChange(false);
    } catch (error) {
      captureError(`user-restriction-save-and-restrict-error`, new StackAssertionError(`Failed to save and restrict user ${user.id}`, { cause: error }));
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemoveRestriction = async () => {
    setIsSaving(true);
    try {
      await user.update({
        restrictedByAdmin: false,
        restrictedByAdminReason: null,
        restrictedByAdminPrivateDetails: null,
      } as any);
      onOpenChange(false);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>User Restriction</DialogTitle>
          <DialogDescription>
            Restricted users cannot access your app by default. You can optionally provide a public reason (shown to the user) and private details (for internal notes).
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-4">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">Public reason (shown to user)</label>
            <Input
              value={publicReason}
              onChange={(e) => setPublicReason(e.target.value)}
              placeholder="Optional message visible to the user"
              disabled={isSaving}
            />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">Private details (internal only)</label>
            <Textarea
              value={privateDetails}
              onChange={(e) => setPrivateDetails(e.target.value)}
              placeholder="Internal notes, e.g., which sign-up rule triggered"
              required
              className="min-h-[80px]"
              disabled={isSaving}
            />
          </div>
        </div>
        <DialogFooter className="flex-col sm:flex-row gap-2">
          {restrictedByAdmin && (
            <Button
              variant="destructive"
              onClick={handleRemoveRestriction}
              disabled={isSaving}
              className="sm:mr-auto"
            >
              Remove manual restriction
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button

            onClick={handleSaveAndRestrict}
            disabled={isSaving}
          >
            Save &amp; restrict user
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


// Restriction banner shown at top of page when user is restricted
function RestrictionBanner({ user }: { user: ServerUser }) {
  if (!user.isRestricted) return null;

  const restrictedByAdmin = (user as any).restrictedByAdmin ?? false;
  const restrictedByAdminReason = (user as any).restrictedByAdminReason ?? null;
  const restrictedByAdminPrivateDetails = (user as any).restrictedByAdminPrivateDetails ?? null;
  const reasonText = getRestrictionReasonText(user);

  return (
    <Alert variant="destructive" className="mb-4">
      <ProhibitIcon size={16} />
      <AlertTitle>This user is currently restricted</AlertTitle>
      <AlertDescription className="mt-2">
        <p className="mb-2">
          Restricted users cannot access your app by default. This user is restricted because: <strong>{reasonText}</strong>.
        </p>
        {user.restrictedReason?.type === 'email_not_verified' && (
          <p className="text-sm opacity-80">
            The user needs to verify their email address to remove this restriction.
          </p>
        )}
        {user.restrictedReason?.type === 'anonymous' && (
          <p className="text-sm opacity-80">
            Anonymous users must sign up with credentials to remove this restriction.
          </p>
        )}
        {user.restrictedReason?.type === 'restricted_by_administrator' && (
          <div className="text-sm opacity-80">
            <p>This user was manually restricted by an administrator.</p>
            {restrictedByAdminReason && (
              <p className="mt-1"><strong>Public reason:</strong> {restrictedByAdminReason}</p>
            )}
            {restrictedByAdminPrivateDetails && (
              <p className="mt-1"><strong>Private details:</strong> {restrictedByAdminPrivateDetails}</p>
            )}
          </div>
        )}
      </AlertDescription>
    </Alert>
  );
}

function UserDetails({ user }: { user: ServerUser }) {
  const [restrictionDialogOpen, setRestrictionDialogOpen] = useState(false);

  const isRestricted = user.isRestricted;
  const reasonText = getRestrictionReasonText(user);
  const restrictedDisplayValue = isRestricted ? `Yes — ${reasonText}` : 'No';

  const items = useMemo<DesignEditableGridItem[]>(() => [
    {
      type: "text",
      icon: <HashIcon size={14} />,
      name: "User ID",
      value: user.id,
      readOnly: true,
    },
    {
      type: "text",
      icon: <EnvelopeIcon size={14} />,
      name: "Primary email",
      value: user.primaryEmail ?? "",
      placeholder: "-",
      readOnly: true,
    },
    {
      type: "text",
      icon: <AtIcon size={14} />,
      name: "Display name",
      value: user.displayName ?? "",
      placeholder: "-",
      onUpdate: async (newName) => {
        await user.setDisplayName(newName);
      },
    },
    {
      type: "text",
      icon: <SquareIcon size={14} />,
      name: "Password",
      value: "",
      placeholder: user.hasPassword ? "************" : "-",
      onUpdate: async (newPassword) => {
        await user.setPassword({ password: newPassword });
      },
    },
    {
      type: "text",
      icon: <ShieldIcon size={14} />,
      name: "2-factor auth",
      value: user.isMultiFactorRequired ? "Enabled" : "",
      placeholder: "Disabled",
      readOnly: true,
    },
    {
      type: "text",
      icon: <CalendarIcon size={14} />,
      name: "Signed up at",
      value: user.signedUpAt.toDateString(),
      readOnly: true,
    },
    {
      type: "text",
      icon: <ShieldIcon size={14} />,
      name: "Risk score: bot",
      value: String(user.riskScores.signUp.bot),
      onUpdate: async (newValue) => {
        await user.update({
          riskScores: {
            signUp: {
              bot: parseRiskScore(newValue),
              freeTrialAbuse: user.riskScores.signUp.freeTrialAbuse,
            },
          },
        });
      },
    },
    {
      type: "custom",
      icon: <GlobeIcon size={14} />,
      name: "Sign-up country code",
      children: (
        <CountryCodeInput
          value={user.countryCode ?? null}
          onChange={(newValue) => {
            runAsynchronouslyWithAlert(async () => {
              await user.update({
                countryCode: newValue ? normalizeCountryCode(newValue) : null,
              });
            });
          }}
          placeholder="-"
          className="w-full h-7 text-sm"
        />
      ),
    },
    {
      type: "text",
      icon: <ShieldIcon size={14} />,
      name: "Risk score: free trial abuse",
      value: String(user.riskScores.signUp.freeTrialAbuse),
      onUpdate: async (newValue) => {
        await user.update({
          riskScores: {
            signUp: {
              bot: user.riskScores.signUp.bot,
              freeTrialAbuse: parseRiskScore(newValue),
            },
          },
        });
      },
    },
    {
      type: "custom-button",
      icon: <ProhibitIcon size={14} />,
      name: "Restricted",
      children: restrictedDisplayValue,
      onClick: () => setRestrictionDialogOpen(true),
    },
  ], [user, restrictedDisplayValue]);

  return (
    <>
      <DesignEditableGrid
        items={items}
        columns={2}
        size="sm"
        deferredSave={false}
      />
      <RestrictionDialog
        user={user}
        open={restrictionDialogOpen}
        onOpenChange={setRestrictionDialogOpen}
      />
    </>
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
  const formSchema = yup.object({
    email: yup.string()
      .email("Please enter a valid e-mail address")
      .defined("E-mail is required")
      .label("E-mail")
      .meta({
        stackFormFieldPlaceholder: "Enter e-mail address",
      }),
    isVerified: yup.boolean()
      .default(false)
      .label("Set as verified")
      .meta({
        description: "E-mails verified by verification emails. Can be used for OTP/magic links"
      }),
    isPrimary: yup.boolean()
      .default(false)
      .label("Set as primary")
      .meta({
        description: "Make this the primary e-mail for the user"
      }),
    isUsedForAuth: yup.boolean()
      .default(false)
      .label("Used for sign-in")
      .meta({
        description: "Allow this e-mail to be used for password sign-in. Also enables OTP/magic links if the e-mail is verified."
      }),
  });

  return (
    <SmartFormDialog
      title="Add E-mail"
      description="Add a new e-mail address to this user account."
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
  return (
    <>
      <SelectField
        control={control}
        name="selected"
        label="Domain"
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
            label="Localhost Port"
            placeholder="3000"
            type="number"
          />
          <Accordion type="single" collapsible className="w-full">
            <AccordionItem value="item-1">
              <AccordionTrigger>Advanced</AccordionTrigger>
              <AccordionContent className="flex flex-col gap-8">
                <div className="flex flex-col gap-2">
                  <InputField
                    label="Handler path"
                    name="handlerPath"
                    control={control}
                    placeholder='/handler'
                  />
                  <Typography variant="secondary" type="footnote">
                    Only modify this if you changed the default handler path in your app
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
        label: "Send",
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
  return (
    <SendEmailWithDomainDialog
      title="Send Verification Email"
      description={`Send a verification email to ${channel.value}? The email will contain a callback link to your domain.`}
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
  const stackAdminApp = useAdminApp();

  return (
    <SendEmailWithDomainDialog
      title="Send Reset Password Email"
      description={`Send a password reset email to ${channel.value}? The email will contain a callback link to your domain.`}
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
  const stackAdminApp = useAdminApp();

  return (
    <SendEmailWithDomainDialog
      title="Send Sign-In Invitation"
      description={`Send a sign-in invitation email to ${channel.value}? The email will contain a callback link to your domain.`}
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

  const contactChannelColumns = useMemo<ColumnDef<ServerContactChannel>[]>(() => [
    {
      accessorKey: "value",
      header: "E-Mail",
    },
    {
      id: "isPrimary",
      header: "Primary",
      cell: ({ row }) => (
        <div className="text-center">
          {row.original.isPrimary ? <CheckIcon className="mx-auto h-4 w-4 text-green-500" /> : null}
        </div>
      ),
    },
    {
      id: "isVerified",
      header: "Verified",
      cell: ({ row }) => (
        <div className="text-center">
          {row.original.isVerified
            ? <CheckIcon className="mx-auto h-4 w-4 text-green-500" />
            : <XIcon className="mx-auto h-4 w-4 text-muted-foreground" />}
        </div>
      ),
    },
    {
      id: "usedForAuth",
      header: "Used for sign-in",
      cell: ({ row }) => (
        <div className="text-center">
          {row.original.usedForAuth
            ? <CheckIcon className="mx-auto h-4 w-4 text-green-500" />
            : <XIcon className="mx-auto h-4 w-4 text-muted-foreground" />}
        </div>
      ),
    },
    {
      id: "actions",
      cell: ({ row }) => {
        const channel = row.original;
        return (
          <div className="flex justify-end">
            <ActionCell
              items={[
                {
                  item: "Send sign-in invitation",
                  onClick: async () => {
                    setSendSignInInvitationDialog({ channel, isOpen: true });
                  },
                },
                ...(!channel.isVerified ? [{
                  item: "Send verification email",
                  onClick: async () => {
                    setSendVerificationEmailDialog({ channel, isOpen: true });
                  },
                }] : []),
                ...(project.config.credentialEnabled ? [{
                  item: "Send reset password email",
                  onClick: async () => {
                    setSendResetPasswordEmailDialog({ channel, isOpen: true });
                  },
                }] : []),
                {
                  item: channel.isVerified ? "Mark as unverified" : "Mark as verified",
                  onClick: async () => { await toggleVerified(channel); },
                },
                ...(!channel.isPrimary ? [{
                  item: "Set as primary",
                  onClick: async () => { await setPrimaryEmail(channel); },
                }] : []),
                {
                  item: channel.usedForAuth ? "Disable for sign-in" : "Enable for sign-in",
                  onClick: async () => { await toggleUsedForAuth(channel); },
                },
                {
                  item: "Delete",
                  danger: true,
                  onClick: async () => { await channel.delete(); },
                },
              ]}
            />
          </div>
        );
      },
    },
  ], [project.config.credentialEnabled]);

  return (
    <>
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

      <DesignCard
        title="Contact Channels"
        icon={EnvelopeIcon}
        glassmorphic={false}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsAddEmailDialogOpen(true)}
          >
            Add E-mail
          </Button>
        }
      >
        {contactChannels.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8">
            <p className='text-sm text-muted-foreground text-center'>
              No contact channels
            </p>
          </div>
        ) : (
          <DesignDataTable
            columns={contactChannelColumns}
            data={contactChannels}
          />
        )}
      </DesignCard>
    </>
  );
}

function UserTeamsSection({ user }: { user: ServerUser }) {
  const stackAdminApp = useAdminApp();
  const teams = user.useTeams();

  const teamColumns = useMemo<ColumnDef<ServerTeam>[]>(() => [
    {
      accessorKey: "id",
      header: "Team ID",
      cell: ({ row }) => (
        <div className="font-mono text-xs bg-muted px-2 py-1 rounded max-w-[120px] truncate">
          {row.original.id}
        </div>
      ),
    },
    {
      accessorKey: "displayName",
      header: "Display Name",
      cell: ({ row }) => (
        <span className="font-medium">{row.original.displayName || '-'}</span>
      ),
    },
    {
      id: "createdAt",
      header: "Created At",
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.original.createdAt.toLocaleDateString()}
        </span>
      ),
    },
    {
      id: "actions",
      cell: ({ row }) => (
        <div className="flex justify-end">
          <ActionCell
            items={[
              {
                item: "View Team",
                onClick: () => {
                  window.open(`/projects/${stackAdminApp.projectId}/teams/${row.original.id}`, '_blank', 'noopener');
                },
              },
            ]}
          />
        </div>
      ),
    },
  ], [stackAdminApp.projectId]);

  return (
    <DesignCard
      title="Teams"
      subtitle="Teams this user belongs to"
      icon={UsersIcon}
      glassmorphic={false}
    >
      {teams.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8">
          <p className='text-sm text-muted-foreground text-center'>
            No teams found
          </p>
        </div>
      ) : (
        <DesignDataTable
          columns={teamColumns}
          data={teams}
        />
      )}
    </DesignCard>
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
      .label("OAuth Provider")
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
            placeholder="Select OAuth provider"
          />
        ),
      }),
    email: yup.string()
      .email("Please enter a valid e-mail address")
      .optional()
      .label("Email")
      .meta({
        stackFormFieldPlaceholder: "Enter email address (optional)",
      }),
    accountId: yup.string()
      .defined("Account ID is required")
      .label("Account ID")
      .meta({
        stackFormFieldPlaceholder: "Enter OAuth account ID",
        description: "The unique account identifier from the OAuth provider",
        stackFormFieldExtraProps: {
          disabled: isEditMode, // Disable account ID editing in edit mode
        },
      }),
    allowSignIn: yup.boolean()
      .default(true)
      .label("Used for sign-in")
      .meta({
        description: "Allow this OAuth provider to be used for authentication"
      }),
    allowConnectedAccounts: yup.boolean()
      .default(true)
      .label("Used for connected accounts")
      .meta({
        description: "Allow this OAuth provider to be used for connected account features"
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
          title: "Account Already Connected",
          description: `A ${providerType} provider with account ID "${accountId}" already exists (possibly for a different user)`,
          variant: "destructive",
        });
      } else {
        console.error(result.error);
        toast({
          title: "Error",
          description: `An unexpected error occurred while ${operation} the OAuth provider.`,
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
      title={isEditMode ? "Edit OAuth Provider" : "Add OAuth Provider"}
      description={isEditMode ? "Update the OAuth provider settings." : "Connect a new OAuth provider to this user account."}
      open={props.open}
      onOpenChange={props.onOpenChange}
      formSchema={schemaWithDefaults}
      onSubmit={handleSubmit}
    />
  );
}

function OAuthProvidersSection({ user }: OAuthProvidersSectionProps) {
  const oauthProviders = user.useOAuthProviders();
  const [isAddProviderDialogOpen, setIsAddProviderDialogOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<ServerOAuthProvider | null>(null);
  const { toast } = useToast();

  const handleProviderUpdate = async (provider: ServerOAuthProvider, updates: { allowSignIn?: boolean, allowConnectedAccounts?: boolean }) => {
    const result = await provider.update(updates);
    if (result.status === "error") {
      if (KnownErrors.OAuthProviderAccountIdAlreadyUsedForSignIn.isInstance(result.error)) {
        toast({
          title: "Account Already Connected",
          description: `A ${provider.type} provider with account ID "${provider.accountId}" is already connected for this user.`,
          variant: "destructive",
        });
      } else {
        const settingType = updates.allowSignIn !== undefined ? "sign-in" : "connected accounts";
        toast({
          title: "Error",
          description: `Failed to update ${settingType} setting.`,
          variant: "destructive",
        });
      }
    } else {
      let successMessage = "";
      if (updates.allowSignIn !== undefined) {
        successMessage = `Sign-in ${provider.allowSignIn ? 'disabled' : 'enabled'} for ${provider.type} provider.`;
      } else if (updates.allowConnectedAccounts !== undefined) {
        successMessage = `Connected accounts ${provider.allowConnectedAccounts ? 'disabled' : 'enabled'} for ${provider.type} provider.`;
      }
      toast({
        title: "Success",
        description: successMessage,
        variant: "success",
      });
    }
  };

  const oauthColumns: ColumnDef<ServerOAuthProvider>[] = [
    {
      accessorKey: "type",
      header: "Provider",
      cell: ({ row }) => (
        <span className="capitalize font-medium">{row.original.type}</span>
      ),
    },
    {
      accessorKey: "email",
      header: "Email",
    },
    {
      accessorKey: "accountId",
      header: "Account ID",
      cell: ({ row }) => (
        <span className="font-mono text-xs truncate block max-w-[160px]">{row.original.accountId}</span>
      ),
    },
    {
      id: "allowSignIn",
      header: () => <span className="whitespace-nowrap">Used for sign-in</span>,
      cell: ({ row }) => (
        <div className="text-center">
          {row.original.allowSignIn
            ? <CheckIcon className="mx-auto h-4 w-4 text-green-500" />
            : <XIcon className="mx-auto h-4 w-4 text-muted-foreground" />}
        </div>
      ),
    },
    {
      id: "allowConnectedAccounts",
      header: () => <span className="whitespace-nowrap">Used for connected accounts</span>,
      cell: ({ row }) => (
        <div className="text-center">
          {row.original.allowConnectedAccounts
            ? <CheckIcon className="mx-auto h-4 w-4 text-green-500" />
            : <XIcon className="mx-auto h-4 w-4 text-muted-foreground" />}
        </div>
      ),
    },
    {
      id: "actions",
      cell: ({ row }) => {
        const provider = row.original;
        return (
          <div className="flex justify-end">
            <ActionCell
              items={[
                {
                  item: "Edit",
                  onClick: () => setEditingProvider(provider),
                },
                {
                  item: provider.allowSignIn ? "Disable sign-in" : "Enable sign-in",
                  onClick: async () => { await handleProviderUpdate(provider, { allowSignIn: !provider.allowSignIn }); },
                },
                {
                  item: provider.allowConnectedAccounts ? "Disable connected accounts" : "Enable connected accounts",
                  onClick: async () => { await handleProviderUpdate(provider, { allowConnectedAccounts: !provider.allowConnectedAccounts }); },
                },
                {
                  item: "Delete",
                  danger: true,
                  onClick: async () => { await provider.delete(); },
                },
              ]}
            />
          </div>
        );
      },
    },
  ];

  return (
    <>
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

      <DesignCard
        title="OAuth Providers"
        icon={KeyIcon}
        glassmorphic={false}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsAddProviderDialogOpen(true)}
          >
            Add Provider
          </Button>
        }
      >
        {oauthProviders.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8">
            <p className='text-sm text-muted-foreground text-center'>
              No OAuth providers connected
            </p>
          </div>
        ) : (
          <DesignDataTable
            columns={oauthColumns}
            data={oauthProviders}
          />
        )}
      </DesignCard>
    </>
  );
}

const ACTIVITY_GRID_WEEKS = 16;
const ACTIVITY_GRID_DAYS = 7;

function ActivityPlaceholder() {
  const cells = useMemo(() => {
    const result: number[] = [];
    for (let i = 0; i < ACTIVITY_GRID_WEEKS * ACTIVITY_GRID_DAYS; i++) {
      result.push(Math.random());
    }
    return result;
  }, []);

  return (
    <div className="hidden xl:flex flex-col items-end gap-1.5 opacity-30 select-none shrink-0 pt-1" aria-hidden>
      <span className="text-[11px] font-medium text-muted-foreground tracking-wide uppercase">Activity</span>
      <div
        className="grid gap-[3px]"
        style={{
          gridTemplateColumns: `repeat(${ACTIVITY_GRID_WEEKS}, 1fr)`,
          gridTemplateRows: `repeat(${ACTIVITY_GRID_DAYS}, 1fr)`,
        }}
      >
        {cells.map((rand, i) => (
          <div
            key={i}
            className={cn(
              "w-[9px] h-[9px] rounded-[2px]",
              rand < 0.55
                ? "bg-foreground/[0.06]"
                : rand < 0.75
                  ? "bg-foreground/[0.12]"
                  : rand < 0.9
                    ? "bg-foreground/[0.22]"
                    : "bg-foreground/[0.35]",
            )}
          />
        ))}
      </div>
    </div>
  );
}

const USER_PAGE_TABS = [
  { id: "profile", label: "Profile" },
  { id: "analytics", label: "Analytics" },
  { id: "payments", label: "Payments" },
  { id: "fraud-protection", label: "Fraud Protection" },
] as const;

type UserPageTab = typeof USER_PAGE_TABS[number]["id"];

function TabPlaceholder({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
      <p className="text-sm font-medium">{label}</p>
      <p className="text-xs">Coming soon</p>
    </div>
  );
}

function UserPage({ user }: { user: ServerUser }) {
  const [selectedTab, setSelectedTab] = useState<UserPageTab>("profile");

  return (
    <PageLayout>
      <div className="flex flex-col gap-6">
        <RestrictionBanner user={user} />
        <div className="flex items-start justify-between gap-6">
          <UserHeader user={user} />
          <ActivityPlaceholder />
        </div>
        <DesignCategoryTabs
          categories={[...USER_PAGE_TABS]}
          selectedCategory={selectedTab}
          onSelect={(id) => setSelectedTab(id as UserPageTab)}
          showBadge={false}
          size="sm"
          glassmorphic={false}
        />
        {selectedTab === "profile" && (
          <div className="flex flex-col gap-6">
            <UserDetails user={user} />
            <Separator />
            <ContactChannelsSection user={user} />
            <UserTeamsSection user={user} />
            <OAuthProvidersSection user={user} />
            <MetadataSection
              entityName="user"
              docsUrl={userMetadataDocsUrl}
              clientMetadata={user.clientMetadata}
              clientReadOnlyMetadata={user.clientReadOnlyMetadata}
              serverMetadata={user.serverMetadata}
              onUpdateClientMetadata={async (value) => {
                await user.setClientMetadata(value);
              }}
              onUpdateClientReadOnlyMetadata={async (value) => {
                await user.setClientReadOnlyMetadata(value);
              }}
              onUpdateServerMetadata={async (value) => {
                await user.setServerMetadata(value);
              }}
            />
          </div>
        )}
        {selectedTab === "analytics" && <TabPlaceholder label="Analytics" />}
        {selectedTab === "payments" && <TabPlaceholder label="Payments" />}
        {selectedTab === "fraud-protection" && <TabPlaceholder label="Fraud Protection" />}
      </div>
    </PageLayout>
  );
}
