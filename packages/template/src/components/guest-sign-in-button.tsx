'use client';

import { Button } from '@hexclave/ui';
import { UserRound } from 'lucide-react';
import { useId, useState } from 'react';
import { useStackApp } from '..';
import { useTranslation } from '../lib/translations';
import { FormWarningText } from './elements/form-warning';

export function GuestSignInButton({
  type,
}: {
  type: 'sign-in' | 'sign-up',
}) {
  const { t } = useTranslation();
  const hexclaveApp = useStackApp();
  const styleId = useId().replaceAll(':', '-');
  const [error, setError] = useState<string | undefined>(undefined);

  return (
    <div className='flex flex-col items-stretch'>
      <Button
        variant='secondary'
        onClick={async () => {
          // <Button> drives its own loading state from this async callback. Surface any error inline
          // (an alert/inline message, never a toast) since there is no browser dialog to give feedback.
          setError(undefined);
          const result = await hexclaveApp.signInAsGuest();
          if (result.status === 'error') {
            setError(result.error.message);
          }
        }}
        className={`stack-oauth-button-${styleId} stack-scope`}
      >
        <div className='flex items-center w-full gap-4'>
          <UserRound />
          <span className='flex-1'>{t('Continue as guest')}</span>
        </div>
      </Button>
      <FormWarningText text={error} />
    </div>
  );
}
