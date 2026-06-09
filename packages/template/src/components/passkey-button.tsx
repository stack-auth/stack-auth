'use client';

import { Button } from '@hexclave/ui';
import { KeyRound } from 'lucide-react';
import { useStackApp } from '..';
import { useTranslation } from '../lib/translations';

export function PasskeyButton({
  type,
}: {
  type: 'sign-in' | 'sign-up',
}) {
  const { t } = useTranslation();
  const hexclaveApp = useStackApp();

  return (
    <>
      <Button
        onClick={async () => { await hexclaveApp.signInWithPasskey(); }}
        variant="plain"
        className="stack-scope h-10 rounded-xl font-medium transition-all duration-150 bg-primary hover:bg-primary/90 text-primary-foreground border border-transparent shadow-sm"
      >
        <div className='flex items-center w-full gap-4'>
          <KeyRound className="h-5 w-5" />
          <span className='flex-1'>
            {type === 'sign-up' ?
              t('Sign up with Passkey') :
              t('Sign in with Passkey')
            }
          </span>
        </div>
      </Button>
    </>
  );
}
