import { Button, Input, Badge, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "~/components/ui";

import { yupResolver } from "@hookform/resolvers/yup";
import { KnownErrors } from "@hexclave/shared/dist/known-errors";
import { strictEmailSchema, yupObject } from "@hexclave/shared/dist/schema-fields";
import { runAsynchronouslyWithAlert } from "@hexclave/shared/dist/utils/promises";
import { DotsThree, EnvelopeSimple, Warning } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import * as yup from "yup";
import { useUser } from "@hexclave/react";
import {
  getCardClassName,
  getDropdownContentClassName,
  getFieldClassName,
  getIconContainerClassName,
  getInsetFormPanelClassName,
  getListContainerClassName,
  getListRowClassName,
  getOutlineButtonClassName,
  getPrimaryButtonClassName,
  getSectionDescriptionClassName,
  getSectionTitleClassName,
  useDesign,
} from "../design-context";

export function EmailsSection(props?: {
  mockMode?: boolean,
}) {
  const design = useDesign();
  const isInMockMode = !!props?.mockMode;
  const user = useUser({ or: isInMockMode ? 'return-null' : 'redirect' });

  // In mock mode, show a placeholder message
  if (isInMockMode && !user) {
    return (
      <div className={getCardClassName(design)}>
        <h3 className={getSectionTitleClassName(design)}>Emails</h3>
        <span className={getSectionDescriptionClassName(design)}>Email management is not available in demo mode.</span>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return <EmailsSectionInner user={user} />;
}

function EmailsSectionInner({ user }: { user: any }) {
  const design = useDesign();
  const contactChannels = user.useContactChannels();
  const [addingEmail, setAddingEmail] = useState(contactChannels.length === 0);
  const [addingEmailLoading, setAddingEmailLoading] = useState(false);
  const [addedEmail, setAddedEmail] = useState<string | null>(null);
  const isLastEmailUsedForAuth = contactChannels.filter((x: any) => x.usedForAuth && (x.type as string) === 'email').length === 1;

  useEffect(() => {
    if (addedEmail) {
      runAsynchronouslyWithAlert(async () => {
        const cc = contactChannels.find((x: any) => x.value === addedEmail);
        if (cc && !cc.isVerified) {
          await cc.sendVerificationEmail();
        }
        setAddedEmail(null);
      });
    }
  }, [contactChannels, addedEmail]);

  const emailSchema = yupObject({
    email: strictEmailSchema('Please enter a valid email address')
      .notOneOf(contactChannels.map((x: any) => x.value), 'Email already exists')
      .defined()
      .nonEmpty('Email is required'),
  });

  const { register, handleSubmit, formState: { errors }, reset } = useForm({
    resolver: yupResolver(emailSchema)
  });

  const onSubmit = async (data: yup.InferType<typeof emailSchema>) => {
    setAddingEmailLoading(true);
    try {
      await user.createContactChannel({ type: 'email', value: data.email, usedForAuth: false });
      setAddedEmail(data.email);
    } finally {
      setAddingEmailLoading(false);
    }
    setAddingEmail(false);
    reset();
  };

  const sortedEmails = [...contactChannels]
    .filter((x: any) => (x.type as string) === 'email')
    .sort((a: any, b: any) => {
      if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
      if (a.isVerified !== b.isVerified) return a.isVerified ? -1 : 1;
      return 0;
    });

  return (
    <div className={getCardClassName(design, "flex flex-col gap-6")}>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h3 className={getSectionTitleClassName(design)}>
            Email Addresses
          </h3>
          <p className={getSectionDescriptionClassName(design)}>
            Manage your personal email addresses, primary contact, and sign-in credentials.
          </p>
        </div>
        {!addingEmail && (
          <Button
            variant="outline"
            onClick={() => setAddingEmail(true)}
            className={getOutlineButtonClassName(design, "px-4 py-2 text-xs font-semibold w-full md:w-auto")}
          >
            Add an email
          </Button>
        )}
      </div>

      {addingEmail && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            runAsynchronouslyWithAlert(handleSubmit(onSubmit));
          }}
          className={getInsetFormPanelClassName(design)}
        >
          <span className="text-sm font-semibold text-foreground">Add New Email</span>
          <div className="flex gap-2">
            <Input
              {...register("email")}
              placeholder="Enter email address"
              className={getFieldClassName(design, "flex-1")}
            />
            <Button
              type="submit"
              loading={addingEmailLoading}
              className={getPrimaryButtonClassName(design, "px-4")}
            >
              Add
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setAddingEmail(false);
                reset();
              }}
              className={getOutlineButtonClassName(design)}
            >
              Cancel
            </Button>
          </div>
          {errors.email && (
            <span className="text-red-500 text-xs font-medium mt-1">{errors.email.message}</span>
          )}
        </form>
      )}

      {sortedEmails.length > 0 && (
        <div className={getListContainerClassName(design)}>
          {sortedEmails.map((cc: any) => (
            <div key={cc.id} className={getListRowClassName(design)}>
              <div className="flex items-center gap-3 min-w-0">
                <div className={getIconContainerClassName(design)}>
                  <EnvelopeSimple className="h-5 w-5" />
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-semibold text-foreground truncate">{cc.value}</span>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {cc.isPrimary && (
                      <Badge className="bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 text-[10px] px-2 py-0 border-0 font-bold rounded-full">
                        Primary
                      </Badge>
                    )}
                    {!cc.isVerified && (
                      <Badge className="bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400 border border-red-200 dark:border-red-900/30 text-[9px] px-1.5 py-0 font-semibold rounded-md">
                        Unverified
                      </Badge>
                    )}
                    {cc.usedForAuth && (
                      <Badge className="bg-zinc-50 text-zinc-700 dark:bg-zinc-900/55 dark:text-zinc-300 border border-zinc-200 dark:border-white/[0.08] text-[9px] px-1.5 py-0 font-semibold rounded-md">
                        Used for sign-in
                      </Badge>
                    )}
                  </div>
                </div>
              </div>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    className="h-8 w-8 p-0 rounded-lg text-muted-foreground hover:text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800/60 transition-colors"
                  >
                    <DotsThree className="h-5 w-5 weight-bold" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className={getDropdownContentClassName(design, "w-[180px]")}>
                  {!cc.isVerified && (
                    <DropdownMenuItem
                      onClick={() => runAsynchronouslyWithAlert(async () => { await cc.sendVerificationEmail(); })}
                      className="cursor-pointer rounded-lg text-foreground focus:bg-zinc-50 dark:focus:bg-zinc-800/60"
                    >
                      Verify Email
                    </DropdownMenuItem>
                  )}
                  {!cc.isPrimary && cc.isVerified && (
                    <DropdownMenuItem
                      onClick={() => runAsynchronouslyWithAlert(async () => { await cc.update({ isPrimary: true }); })}
                      className="cursor-pointer rounded-lg text-foreground focus:bg-zinc-50 dark:focus:bg-zinc-800/60"
                    >
                      Set as Primary
                    </DropdownMenuItem>
                  )}
                  {!cc.isPrimary && !cc.isVerified && (
                    <DropdownMenuItem
                      disabled
                      className="opacity-50 cursor-not-allowed rounded-lg"
                    >
                      Set as Primary (Verify first)
                    </DropdownMenuItem>
                  )}
                  {!cc.usedForAuth && cc.isVerified && (
                    <DropdownMenuItem
                      onClick={() => runAsynchronouslyWithAlert(async () => {
                        try {
                          await cc.update({ usedForAuth: true });
                        } catch (e) {
                          if (KnownErrors.ContactChannelAlreadyUsedForAuthBySomeoneElse.isInstance(e)) {
                            alert("This email is already used for sign-in by another user.");
                            return;
                          }
                          throw e;
                        }
                      })}
                      className="cursor-pointer rounded-lg text-foreground focus:bg-zinc-50 dark:focus:bg-zinc-800/60"
                    >
                      Enable Sign-in
                    </DropdownMenuItem>
                  )}
                  {cc.usedForAuth && !isLastEmailUsedForAuth && (
                    <DropdownMenuItem
                      onClick={() => runAsynchronouslyWithAlert(async () => { await cc.update({ usedForAuth: false }); })}
                      className="cursor-pointer rounded-lg text-foreground focus:bg-zinc-50 dark:focus:bg-zinc-800/60"
                    >
                      Disable Sign-in
                    </DropdownMenuItem>
                  )}
                  {cc.usedForAuth && isLastEmailUsedForAuth && (
                    <DropdownMenuItem
                      disabled
                      className="opacity-50 cursor-not-allowed rounded-lg"
                    >
                      Disable Sign-in (Last auth email)
                    </DropdownMenuItem>
                  )}
                  <div className="my-1 border-t border-black/[0.04] dark:border-white/[0.04]" />
                  {(!isLastEmailUsedForAuth || !cc.usedForAuth) ? (
                    <DropdownMenuItem
                      onClick={() => runAsynchronouslyWithAlert(async () => { await cc.delete(); })}
                      className="cursor-pointer rounded-lg text-red-500 hover:text-red-600 focus:text-red-500"
                    >
                      Remove Email
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem
                      disabled
                      className="opacity-50 cursor-not-allowed rounded-lg text-red-500"
                    >
                      Remove Email (Last auth email)
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
