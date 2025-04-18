'use client';

import { useStackApp } from '@stackframe/stack';
import { Button, Typography } from '@stackframe/stack-ui';
import { useState } from 'react';

export default function CheckoutDemoPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const app = useStackApp();
  const startCheckout = async () => {
    try {
      setLoading(true);
      setError(null);

      // Use the Stack app's createCheckoutUrl method
      const url = await app.createCheckoutUrl([
        {
          productId: 'prod_Ry4WLBaQSnzHFd', // This would be your actual product ID
          quantity: 1
        }
      ]);

      // Redirect to the checkout URL
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
      console.error('Checkout error:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4">
      <div className="max-w-md w-full space-y-8 text-center">
        <Typography type="h2">Checkout Demo</Typography>
        <Typography>Test the Stripe checkout integration</Typography>

        {error && (
          <div className="bg-red-50 p-4 rounded-md">
            <Typography className="text-red-700">{error}</Typography>
          </div>
        )}

        <div className="pt-4">
          <Button
            onClick={startCheckout}
            disabled={loading}
            loading={loading}
            className="w-full"
          >
            {loading ? 'Processing...' : 'Purchase Test Product - $9.99'}
          </Button>
        </div>

        <Typography className="text-gray-500 mt-4">
          This uses Stripe in test mode - no real payments will be processed.
        </Typography>
      </div>
    </div>
  );
}
