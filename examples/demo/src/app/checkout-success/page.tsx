'use client';

import { Button, Typography } from '@stackframe/stack-ui';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function CheckoutSuccessPage() {
  const router = useRouter();
  const [sessionId, setSessionId] = useState<string | null>(null);

  useEffect(() => {
    // In a real application, you would verify the checkout session with Stripe
    // Here we just grab the session ID from the URL if it exists
    const url = new URL(window.location.href);
    const session_id = url.searchParams.get('session_id');
    setSessionId(session_id);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4">
      <div className="max-w-md w-full space-y-8 text-center">
        <div className="flex justify-center mb-4">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        
        <Typography type="h2">Payment Successful!</Typography>
        
        <Typography>
          Thank you for your purchase. Your payment has been processed successfully.
        </Typography>
        
        {sessionId && (
          <Typography className="text-gray-500">
            Session ID: {sessionId}
          </Typography>
        )}
        
        <div className="pt-8">
          <Button onClick={() => router.push('/checkout-demo')}>
            Return to Checkout Demo
          </Button>
        </div>
      </div>
    </div>
  );
}