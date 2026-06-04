'use client';


//===========================================
// THIS FILE IS AUTO-GENERATED FROM TEMPLATE. DO NOT EDIT IT DIRECTLY, INSTEAD EDIT THE CORRESPONDING FILE IN packages/template
//===========================================

import { Button } from '@hexclave/ui';
import { KeyRound } from 'lucide-react';
import { useId } from 'react';
import { useStackApp } from '..';
import { useTranslation } from '../lib/translations';


export function PasskeyButton({
  type,
}: {
  type: 'sign-in' | 'sign-up',
}) {
  const { t } = useTranslation();
  const stackApp = useStackApp();
  const styleId = useId().replaceAll(':', '-');


  return (
    <>
      <Button
        onClick={async () => { await stackApp.signInWithPasskey(); }}
        className={`stack-oauth-button-${styleId} stack-scope`}
      >
        <div className='flex items-center w-full gap-4'>
          <KeyRound />
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
