'use client';

import { runAsynchronouslyWithAlert } from '@hexclave/shared/dist/utils/promises';
import { Button, Label } from '@hexclave/ui';
import { ShieldCheck } from 'lucide-react';
import { useId, useState } from 'react';
import { useStackApp } from '..';
import { useTranslation } from '../lib/translations';
import { FormWarningText } from './elements/form-warning';

/**
 * Auth-page entry for mTLS (client certificate) sign-in. Clicking the button reveals an inline form to
 * provide the certificate and its private key (PEM). The private key is read in the browser, used to sign
 * the server challenge, and never uploaded.
 */
export function CertificateButton({
  type,
}: {
  type: 'sign-in' | 'sign-up',
}) {
  const { t } = useTranslation();
  const hexclaveApp = useStackApp();
  const styleId = useId().replaceAll(':', '-');
  const [expanded, setExpanded] = useState(false);
  const [certificatePem, setCertificatePem] = useState<string | undefined>(undefined);
  const [privateKeyPem, setPrivateKeyPem] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const onSignIn = async () => {
    setError(undefined);
    if (!certificatePem || !privateKeyPem) {
      setError(t('Please select both your certificate and private key files.'));
      return;
    }
    setLoading(true);
    try {
      const result = await hexclaveApp.signInWithCertificate({ certificatePem, privateKeyPem });
      if (result.status === 'error') {
        setError(result.error.message);
      }
    } finally {
      setLoading(false);
    }
  };

  if (!expanded) {
    return (
      <Button
        variant='secondary'
        onClick={() => setExpanded(true)}
        className={`stack-oauth-button-${styleId} stack-scope`}
      >
        <div className='flex items-center w-full gap-4'>
          <ShieldCheck />
          <span className='flex-1'>{t('Sign in with certificate')}</span>
        </div>
      </Button>
    );
  }

  return (
    <div className='flex flex-col items-stretch gap-2 border rounded-md p-3 stack-scope'>
      <Label className='text-sm'>{t('Certificate (PEM)')}</Label>
      <input
        type='file'
        accept='.pem,.crt,.cer'
        className='text-sm'
        onChange={(e) => {
          const file = e.target.files?.[0];
          runAsynchronouslyWithAlert((async () => { setCertificatePem(file ? await file.text() : undefined); })());
        }}
      />
      <Label className='text-sm mt-2'>{t('Private key (PEM)')}</Label>
      <input
        type='file'
        accept='.pem,.key'
        className='text-sm'
        onChange={(e) => {
          const file = e.target.files?.[0];
          runAsynchronouslyWithAlert((async () => { setPrivateKeyPem(file ? await file.text() : undefined); })());
        }}
      />
      <FormWarningText text={error} />
      <Button className='mt-2' loading={loading} onClick={onSignIn}>
        {t('Sign in')}
      </Button>
    </div>
  );
}
