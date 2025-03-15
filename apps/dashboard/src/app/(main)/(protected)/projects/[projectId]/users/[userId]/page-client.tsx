"use client";

import { SmartFormDialog } from "@/components/form-dialog";
import { SettingCard } from "@/components/settings";
import { DeleteUserDialog, ImpersonateUserDialog } from "@/components/user-dialogs";
import { useThemeWatcher } from '@/lib/theme';
import MonacoEditor from '@monaco-editor/react';
import { ServerContactChannel, ServerUser } from "@stackframe/stack";
import { useAsyncCallback } from "@stackframe/stack-shared/dist/hooks/use-async-callback";
import { fromNow } from "@stackframe/stack-shared/dist/utils/dates";
import { throwErr } from '@stackframe/stack-shared/dist/utils/errors';
import { deindent } from "@stackframe/stack-shared/dist/utils/strings";
import { ActionCell, Avatar, AvatarFallback, AvatarImage, Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Input, Separator, SimpleTooltip, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Typography, cn } from "@stackframe/stack-ui";
import { AtSign, Calendar, Check, Hash, Mail, MoreHorizontal, Shield, SquareAsterisk, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import * as yup from "yup";
import { PageLayout } from "../../page-layout";
import { useAdminApp } from "../../use-admin-app";

type UserInfoProps = {
  icon: React.ReactNode,
  children: React.ReactNode,
  name: string,
}


type EditableInputProps = {
  value: string,
  initialEditValue?: string | undefined,
  onUpdate?: (value: string) => Promise<void>,
  readOnly?: boolean,
  placeholder?: string,
  inputClassName?: string,
  shiftTextToLeft?: boolean,
};

function EditableInput({ value, initialEditValue, onUpdate, readOnly, placeholder, inputClassName, shiftTextToLeft }: EditableInputProps) {
  const [editValue, setEditValue] = useState<string | null>(null);
  const editing = editValue !== null;
  const [hasChanged, setHasChanged] = useState(false);

  const forceAllowBlur = useRef(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const acceptRef = useRef<HTMLButtonElement>(null);

  const [handleUpdate, isLoading] = useAsyncCallback(async (value: string) => {
    await onUpdate?.(value);
  }, [onUpdate]);

  return <div
    className="flex gap-2 items-center"
    onFocus={() => {
      if (!readOnly) {
        setEditValue(editValue ?? initialEditValue ?? value);
      }
    }}
    onBlur={(ev) => {
      if (!forceAllowBlur.current) {
        if (!hasChanged) {
          setEditValue(null);
        } else {
          // TODO this should probably be a blocking dialog instead, and it should have a "cancel" button that focuses the input again
          if (confirm("You have unapplied changes. Would you like to save them?")) {
            acceptRef.current?.click();
          } else {
            setEditValue(null);
            setHasChanged(false);
          }
        }
      }
    }}
    onMouseDown={(ev) => {
      // prevent blur from happening
      ev.preventDefault();
      return false;
    }}
  >
    <Input
      ref={inputRef}
      readOnly={readOnly}
      disabled={isLoading}
      placeholder={placeholder}
      tabIndex={readOnly ? -1 : undefined}
      className={cn(
        "w-full px-1 py-0 h-[unset] [&:not(:hover)]:border-transparent",
        readOnly && "border-transparent focus-visible:ring-0",
        shiftTextToLeft && "ml-[-7px]",
        inputClassName,
      )}
      value={editValue ?? value}
      autoComplete="off"
      style={{
        textOverflow: "ellipsis",
      }}
      onChange={(e) => {
        setEditValue(e.target.value);
        setHasChanged(true);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          acceptRef.current?.click();
        }
      }}
      onMouseDown={(ev) => {
        // parent prevents mousedown, so we stop it here
        ev.stopPropagation();
      }}
    />
    <div className="flex gap-2" style={{
      overflow: "hidden",
      width: editing ? "4rem" : 0,
      opacity: editing ? 1 : 0,
      transition: "width 0.2s ease-in-out, opacity 0.2s ease-in-out",
    }}>
      {["accept", "reject"].map((action) => (
        <Button
          ref={action === "accept" ? acceptRef : undefined}
          key={action}
          disabled={isLoading}
          type="button"
          variant="plain"
          size="plain"
          className={cn(
            "min-h-5 min-w-5 h-5 w-5 rounded-full flex items-center justify-center",
            action === "accept" ? "bg-green-500 active:bg-green-600" : "bg-red-500 active:bg-red-600"
          )}
          onClick={async () => {
            try {
              forceAllowBlur.current = true;
              inputRef.current?.blur();
              if (action === "accept") {
                await handleUpdate(editValue ?? throwErr("No value to update"));
              }
              setEditValue(null);
              setHasChanged(false);
            } finally {
              forceAllowBlur.current = false;
            }
          }}
        >
          {action === "accept" ? <Check size={15} /> : <X size={15} />}
        </Button>
      ))}
    </div>
  </div>;
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
  const formatJson = (json: string) => JSON.stringify(JSON.parse(json), null, 2);
  const [hasChanged, setHasChanged] = useState(false);

  const { mounted, theme } = useThemeWatcher();

  const [value, setValue] = useState(formatJson(initialValue));
  const isJson = useMemo(() => {
    try {
      JSON.parse(value);
      return true;
    } catch (e) {
      return false;
    }
  }, [value]);

  const handleSave = async () => {
    if (isJson) {
      const formatted = formatJson(value);
      setValue(formatted);
      await onUpdate?.(JSON.parse(formatted));
      setHasChanged(false);
    }
  };

  return <div className="flex flex-col">
    <h3 className='text-sm mb-4 font-semibold'>
      {title}
      <SimpleTooltip tooltip={hint} type="info" inline className="ml-2 mb-[2px]" />
    </h3>
    {mounted && (
      <div className={cn("rounded-md overflow-hidden", theme !== 'dark' && "border")}>
        <MonacoEditor
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
    )}
    <div className={cn('self-end flex items-end gap-2 transition-all h-0 opacity-0 overflow-hidden', hasChanged && 'h-[48px] opacity-100')}>
      <Button
        variant="ghost"
        onClick={() => {
          setValue(formatJson(initialValue));
          setHasChanged(false);
        }}>
        Revert
      </Button>
      <Button
        variant={isJson ? "default" : "secondary"}
        disabled={!isJson}
        onClick={handleSave}>Save</Button>
    </div>
  </div>;
}

export default function PageClient({ userId }: { userId: string }) {
  const stackAdminApp = useAdminApp();
  const user = stackAdminApp.useUser(userId);

  if (user === null) {
    return <PageLayout
      title="User Not Found"
    >
      User Not Found
    </PageLayout>;
  }

  return <UserPage user={user}/>;
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
        <p>Last active {fromNow(user.lastActiveAt)}</p>
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
              <span>Impersonate</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setIsDeleteModalOpen(true)}>
              <Typography className="text-destructive">Delete</Typography>
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
  return (
    <div className="grid grid-cols-[min-content_1fr] lg:grid-cols-[min-content_1fr_min-content_1fr] gap-2 text-sm px-4">
      <UserInfo icon={<Hash size={16}/>} name="User ID">
        <EditableInput value={user.id} readOnly />
      </UserInfo>
      <UserInfo icon={<Mail size={16}/>} name="Primary email">
        <EditableInput value={user.primaryEmail ?? ""} placeholder={"-"} readOnly/>
      </UserInfo>
      <UserInfo icon={<AtSign size={16}/>} name="Display name">
        <EditableInput value={user.displayName ?? ""} placeholder={"-"} onUpdate={async (newName) => {
          await user.setDisplayName(newName);
        }}/>
      </UserInfo>
      <UserInfo icon={<SquareAsterisk size={16}/>} name="Password">
        <EditableInput value={user.hasPassword ? '************' : ''} placeholder="-" readOnly />
      </UserInfo>
      <UserInfo icon={<Shield size={16}/>} name="2-factor auth">
        <EditableInput value={user.otpAuthEnabled ? 'Enabled' : ''} placeholder='Disabled' readOnly />
      </UserInfo>
      <UserInfo icon={<Calendar size={16}/>} name="Signed up at">
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

        const channel = await user.createContactChannel({
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

function ContactChannelsSection({ user }: ContactChannelsSectionProps) {
  const contactChannels = user.useContactChannels();
  const [isAddEmailDialogOpen, setIsAddEmailDialogOpen] = useState(false);

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
          <h2 className="text-lg font-semibold">Contact Channels</h2>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setIsAddEmailDialogOpen(true)}
        >
          Add E-mail
        </Button>
      </div>

      <AddEmailDialog
        user={user}
        open={isAddEmailDialogOpen}
        onOpenChange={setIsAddEmailDialogOpen}
      />

      {contactChannels.length === 0 ? (
        <div className="flex flex-col items-center gap-2 p-4 border rounded-md bg-muted/10">
          <p className='text-sm text-gray-500 text-center'>
            No contact channels
          </p>
        </div>
      ) : (
        <div className='border rounded-md'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>E-Mail</TableHead>
                <TableHead className="text-center">Primary</TableHead>
                <TableHead className="text-center">Verified</TableHead>
                <TableHead className="text-center">Used for sign-in</TableHead>
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
                        ...(!channel.isVerified ? [{
                          item: "Send verification email",
                          onClick: async () => {
                            await channel.sendVerificationEmail();
                          },
                        }] : []),
                        {
                          item: channel.isVerified ? "Mark as unverified" : "Mark as verified",
                          onClick: async () => {
                            await toggleVerified(channel);
                          },
                        },
                        ...(!channel.isPrimary ? [{
                          item: "Set as primary",
                          onClick: async () => {
                            await setPrimaryEmail(channel);
                          },
                        }] : []),
                        {
                          item: channel.usedForAuth ? "Disable for sign-in" : "Enable for sign-in",
                          onClick: async () => {
                            await toggleUsedForAuth(channel);
                          },
                        },
                        {
                          item: "Delete",
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

type MetadataSectionProps = {
  user: ServerUser,
};

function MetadataSection({ user }: MetadataSectionProps) {
  return (
    <SettingCard
      title="Metadata"
      description="Use metadata to store a custom JSON object on the user."
    >
      <div className="grid gap-4 grid-cols-1 lg:grid-cols-3">
        <MetadataEditor
          title="Client"
          hint="Readable and writable from both clients and servers."
          initialValue={JSON.stringify(user.clientMetadata)}
          onUpdate={async (value) => {
            await user.setClientMetadata(value);
          }}
        />
        <MetadataEditor
          title="Client Read-Only"
          hint="Readable from clients, but only writable from servers."
          initialValue={JSON.stringify(user.clientReadOnlyMetadata)}
          onUpdate={async (value) => {
            await user.setClientReadOnlyMetadata(value);
          }}
        />
        <MetadataEditor
          title="Server"
          hint="Readable and writable from servers. Not accessible to clients."
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
        <MetadataSection user={user} />
      </div>
    </PageLayout>
  );
}
