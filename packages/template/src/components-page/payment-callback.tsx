'use client';

import { runAsynchronously } from '@stackframe/stack-shared/dist/utils/promises';
import { useEffect, useState } from 'react';
import { useStackApp } from '..';
import { MessageCard } from '../components/message-cards/message-card';

export type PaymentCallbackProps = {
  fullPage?: boolean,
  searchParams: Record<string, string>,
};

export function PaymentCallback({ fullPage = false, searchParams }: PaymentCallbackProps) {
  const app = useStackApp();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    runAsynchronously(async () => {
      try {
        const sessionId = searchParams.session_id;

        if (!sessionId) {
          setStatus('error');
          setErrorMessage('No payment session ID found in URL');
          return;
        }

        // Here you would typically verify the payment with your backend
        // For now, we'll just assume success if there's a session_id
        setStatus('success');
      } catch (error) {
        setStatus('error');
        setErrorMessage(error instanceof Error ? error.message : 'An unexpected error occurred');
      }
    });
  }, [searchParams]);

  if (status === 'loading') {
    return (
      <MessageCard title="Processing Payment" fullPage={fullPage}>
        Verifying your payment, please wait...
      </MessageCard>
    );
  }

  if (status === 'error') {
    return (
      <MessageCard
        title="Payment Error"
        fullPage={fullPage}
        primaryButtonText="Return to Home"
        primaryAction={() => app.redirectToHome()}
      >
        {errorMessage || 'There was an error processing your payment.'}
      </MessageCard>
    );
  }

  return (
    <MessageCard
      title="Payment Successful"
      fullPage={fullPage}
      primaryButtonText="Return to Home"
      primaryAction={() => app.redirectToHome()}
    >
      Thank you for your purchase. Your payment has been processed successfully.
    </MessageCard>
  );
}
