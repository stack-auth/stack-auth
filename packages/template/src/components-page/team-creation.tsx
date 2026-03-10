'use client';

import { yupResolver } from "@hookform/resolvers/yup";
import { yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { Button, Input, Label, Typography } from "@stackframe/stack-ui";
import { useState } from "react";
import { useForm } from "react-hook-form";
import * as yup from "yup";
import { MessageCard, useStackApp, useUser } from "..";
import { FormWarningText } from "../components/elements/form-warning";
import { MaybeFullPage } from "../components/elements/maybe-full-page";
import { useTranslation } from "../lib/translations";

export function TeamCreation(props: { fullPage?: boolean }) {
  const { t } = useTranslation();

  const schema = yupObject({
    displayName: yupString().defined().nonEmpty(t('Please enter a team name')),
  });

  const { register, handleSubmit, formState: { errors } } = useForm({
    resolver: yupResolver(schema)
  });
  const app = useStackApp();
  const project = app.useProject();
  const user = useUser({ or: 'redirect' });
  const [loading, setLoading] = useState(false);
  const navigate = app.useNavigate();

  if (!project.config.clientTeamCreationEnabled) {
    return <MessageCard title={t('Team creation is not enabled')} />;
  }

  const onSubmit = async (data: yup.InferType<typeof schema>) => {
    setLoading(true);

    try {
      const team = await user.createTeam({ displayName: data.displayName });
      navigate(`${app.urls.handler}/team-settings/${team.id}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <MaybeFullPage fullPage={!!props.fullPage}>
      <div className='stack-scope flex flex-col items-stretch' style={{ maxWidth: '380px', flexBasis: '380px', padding: props.fullPage ? '1rem' : 0 }}>
        <div className="text-center mb-6">
          <Typography type='h2'>
            {t('Create a Team')}
          </Typography>
        </div>
        <form
          className="flex flex-col items-stretch stack-scope"
          onSubmit={e => runAsynchronously(handleSubmit(onSubmit)(e))}
          noValidate
        >
          <Label htmlFor="display-name" className="mb-1">{t('Display name')}</Label>
          <Input
            id="display-name"
            {...register('displayName')}
          />
          <FormWarningText text={errors.displayName?.message?.toString()} />

          <Button type="submit" className="mt-6" loading={loading}>
            {t('Create')}
          </Button>
        </form>
      </div>
    </MaybeFullPage>
  );
}
