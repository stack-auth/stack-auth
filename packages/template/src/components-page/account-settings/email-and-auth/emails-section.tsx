import { yupResolver } from "@hookform/resolvers/yup";
import { KnownErrors } from "@stackframe/stack-shared/dist/known-errors";
import { strictEmailSchema, yupObject } from "@stackframe/stack-shared/dist/schema-fields";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { ActionCell, Badge, Button, Input, Table, TableBody, TableCell, TableRow, Typography } from "@stackframe/stack-ui";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import * as yup from "yup";
import { FormWarningText } from "../../../components/elements/form-warning";
import { useUser } from "../../../lib/hooks";
import { useTranslation } from "../../../lib/translations";

export function EmailsSection(props?: {
  mockMode?: boolean,
}) {
  const { t } = useTranslation();
  const user = useUser({ or: props?.mockMode ? 'return-null' : 'redirect' });

  // In mock mode, show a placeholder message
  if (props?.mockMode && !user) {
    return (
      <div>
        <div className='flex flex-col md:flex-row justify-between mb-4 gap-4'>
          <Typography className='font-medium'>{t("Emails")}</Typography>
        </div>
        <Typography variant='secondary'>{t("Email management is not available in demo mode.")}</Typography>
      </div>
    );
  }

  if (!user) {
    return null; // This shouldn't happen in non-mock mode due to redirect
  }

  const contactChannels = user.useContactChannels();
  const [addingEmail, setAddingEmail] = useState(contactChannels.length === 0);
  const [addingEmailLoading, setAddingEmailLoading] = useState(false);
  const [addedEmail, setAddedEmail] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const isLastEmail = contactChannels.filter(x => x.usedForAuth && x.type === 'email').length === 1;

  useEffect(() => {
    if (addedEmail) {
      runAsynchronously(async () => {
        const cc = contactChannels.find(x => x.value === addedEmail);
        if (cc && !cc.isVerified) {
          await cc.sendVerificationEmail();
        }
        setAddedEmail(null);
      });
    }
  }, [contactChannels, addedEmail]);

  const emailSchema = yupObject({
    email: strictEmailSchema(t('Please enter a valid email address'))
      .notOneOf(contactChannels.map(x => x.value), t('Email already exists'))
      .defined()
      .nonEmpty(t('Email is required')),
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

  return (
    <div>
      <div className='flex flex-col md:flex-row justify-between mb-4 gap-4'>
        <Typography className='font-medium'>{t("Emails")}</Typography>
        {addingEmail ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              runAsynchronously(handleSubmit(onSubmit));
            }}
            className='flex flex-col'
          >
            <div className='flex gap-2'>
              <Input
                {...register("email")}
                placeholder={t("Enter email")}
              />
              <Button type="submit" loading={addingEmailLoading}>
                {t("Add")}
              </Button>
              <Button
                variant='secondary'
                onClick={() => {
                  setAddingEmail(false);
                  reset();
                }}
              >
                {t("Cancel")}
              </Button>
            </div>
            {errors.email && <FormWarningText text={errors.email.message} />}
          </form>
        ) : (
          <div className='flex md:justify-end'>
            <Button variant='secondary' onClick={() => setAddingEmail(true)}>{t("Add an email")}</Button>
          </div>
        )}
      </div>

      {contactChannels.length > 0 ? (
        <div className='border rounded-md'>
          <Table>
            <TableBody>
              {/*eslint-disable-next-line @typescript-eslint/no-unnecessary-condition*/}
              {contactChannels.filter(x => x.type === 'email')
                .sort((a, b) => {
                  if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
                  if (a.isVerified !== b.isVerified) return a.isVerified ? -1 : 1;
                  return 0;
                })
                .map(x => (
                  <TableRow key={x.id}>
                    <TableCell>
                      <div className='flex flex-col md:flex-row gap-2 md:gap-4'>
                        {x.value}
                        <div className='flex gap-2'>
                          {x.isPrimary ? <Badge>{t("Primary")}</Badge> : null}
                          {!x.isVerified ? <Badge variant='destructive'>{t("Unverified")}</Badge> : null}
                          {x.usedForAuth ? <Badge variant='outline'>{t("Used for sign-in")}</Badge> : null}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="flex justify-end">
                      <ActionCell items={[
                        ...(!x.isVerified ? [{
                          item: t("Send verification email"),
                          onClick: async () => { await x.sendVerificationEmail(); },
                        }] : []),
                        ...(!x.isPrimary && x.isVerified ? [{
                          item: t("Set as primary"),
                          onClick: async () => { await x.update({ isPrimary: true }); },
                        }] :
                          !x.isPrimary ? [{
                            item: t("Set as primary"),
                            onClick: async () => {},
                            disabled: true,
                            disabledTooltip: t("Please verify your email first"),
                          }] : []),
                        ...(!x.usedForAuth && x.isVerified ? [{
                          item: t("Use for sign-in"),
                          onClick: async () => {
                            try {
                              await x.update({ usedForAuth: true });
                            } catch (e) {
                              if (KnownErrors.ContactChannelAlreadyUsedForAuthBySomeoneElse.isInstance(e)) {
                                alert(t("This email is already used for sign-in by another user."));
                              }
                            }
                          }
                        }] : []),
                        ...(x.usedForAuth && !isLastEmail ? [{
                          item: t("Stop using for sign-in"),
                          onClick: async () => { await x.update({ usedForAuth: false }); },
                        }] : x.usedForAuth ? [{
                          item: t("Stop using for sign-in"),
                          onClick: async () => {},
                          disabled: true,
                          disabledTooltip: t("You can not remove your last sign-in email"),
                        }] : []),
                        ...(!isLastEmail || !x.usedForAuth ? [{
                          item: t("Remove"),
                          onClick: async () => { await x.delete(); },
                          danger: true,
                        }] : [{
                          item: t("Remove"),
                          onClick: async () => {},
                          disabled: true,
                          disabledTooltip: t("You can not remove your last sign-in email"),
                        }]),
                      ]}/>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </div>
  );
}
