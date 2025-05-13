'use client';

import { Button, Card, CardContent, CardFooter, CardHeader, Typography } from '@stackframe/stack-ui';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

type CliAuthState = {
  status: 'idle' | 'initiating' | 'waiting' | 'polling' | 'success' | 'expired' | 'used' | 'error',
  pollingCode?: string,
  loginCode?: string,
  handlerConfirmationUrl?: string, // Renamed
  customConfirmationUrl?: string, // Added
  errorMessage?: string,
  refreshToken?: string, // Store the token on success
};

// Renamed function to reflect the new file path
export default function CliAuthInitPage() {
  const [authState, setAuthState] = useState<CliAuthState>({ status: 'idle' });
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Cleanup polling on component unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  const initiateCliAuth = async () => {
    setAuthState({ status: 'initiating' });
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);

    try {
      const response = await fetch('/api/cli-auth/initiate', {
        method: 'POST',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      // Generate both confirmation URLs
      const handlerConfirmationUrl = `${window.location.origin}/handler/cli-auth-confirm?login_code=${data.login_code}`;
      const customConfirmationUrl = `${window.location.origin}/cli-auth/custom-confirm?login_code=${data.login_code}`;

      setAuthState({
        status: 'waiting',
        pollingCode: data.polling_code,
        loginCode: data.login_code,
        handlerConfirmationUrl: handlerConfirmationUrl, // Updated name
        customConfirmationUrl: customConfirmationUrl, // Added
      });

      // Start polling immediately after initiation
      startPolling(data.polling_code);

    } catch (error: any) {
      console.error("Initiation failed:", error);
      setAuthState({ status: 'error', errorMessage: error.message });
    }
  };

  const pollStatus = async (pollingCode: string) => {
    // Avoid multiple polls running concurrently if one takes long
    if (authState.status === 'polling') return;
    setAuthState(prev => ({ ...prev, status: 'polling' }));

    try {
      const response = await fetch('/api/cli-auth/poll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pollingCode }),
      });

      const data = await response.json();

      if (response.status === 201 && data.status === 'success') {
        setAuthState({
          status: 'success',
          refreshToken: data.refresh_token,
        });
        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      } else if (data.status === 'waiting') {
        setAuthState(prev => ({ ...prev, status: 'waiting' })); // Stay in waiting state
      } else if (data.status === 'expired') {
        setAuthState({ status: 'expired' });
        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      } else if (data.status === 'used') {
        setAuthState({ status: 'used' });
        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      } else {
        // Handle other potential errors or unexpected statuses
        throw new Error(data.error || `Unexpected polling status: ${data.status || response.status}`);
      }
    } catch (error: any) {
      console.error("Polling failed:", error);
      setAuthState({ status: 'error', errorMessage: error.message });
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    }
  };

  const startPolling = (pollingCode: string) => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    // Poll immediately, then set interval
    pollStatus(pollingCode).catch(error => {
      console.error("Initial poll failed immediately:", error);
      // Error state is set within pollStatus, so just log here
    });
    pollIntervalRef.current = setInterval(() => {
      pollStatus(pollingCode).catch(error => {
        console.error("Interval poll failed:", error);
        // Error state is set within pollStatus, stop polling if interval causes repeated logs
        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      });
    }, 3000); // Poll every 3 seconds
  };

  const resetState = () => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
     setAuthState({ status: 'idle' });
  };

  return (
    <div className="container mx-auto p-4 flex justify-center">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <Typography type='h3' className="text-center">CLI Authentication Simulation</Typography>
        </CardHeader>
        <CardContent className="space-y-4">
          {authState.status === 'idle' && (
            <Typography className="text-center">
              Click the button below to simulate the initiation of a CLI login process.
            </Typography>
          )}

          {authState.status === 'initiating' && (
            <Typography className="text-center">Initiating...</Typography>
          )}

          {/* Updated section to show both links */}
          {(authState.status === 'waiting' || authState.status === 'polling') && (
            <div className="text-center space-y-4">
              <Typography>Initiation successful! Waiting for confirmation...</Typography>
              <Typography variant="secondary">
                Normally, the CLI would open a confirmation URL automatically. For this simulation, please open one of the URLs manually in a new tab:
              </Typography>

              {/* Link to Built-in Handler */}
              {authState.handlerConfirmationUrl && (
                <div>
                  <Typography variant="secondary" className="mb-1">1. Built-in Handler Page:</Typography>
                  <Link
                    href={authState.handlerConfirmationUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 break-all"
                  >
                    {authState.handlerConfirmationUrl}
                  </Link>
                </div>
              )}

              {/* Link to Custom Page */}
              {authState.customConfirmationUrl && (
                <div className="mt-3">
                  <Typography variant="secondary" className="mb-1">2. Custom Confirmation Page:</Typography>
                  <Link
                    href={authState.customConfirmationUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-teal-600 hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-teal-500 break-all"
                  >
                    {authState.customConfirmationUrl}
                  </Link>
                </div>
              )}

              <Typography variant="secondary" className="pt-2">Status: {authState.status === 'polling' ? 'Polling for confirmation...' : 'Waiting for you to open a link...'}</Typography>
            </div>
          )}

          {authState.status === 'success' && (
            <div className="text-center space-y-3 p-4 bg-green-100 rounded">
              <Typography type="h4" className="text-green-800">Success!</Typography>
              <Typography className="text-green-700">CLI authentication confirmed.</Typography>
              <Typography variant="secondary" className="text-xs break-all text-green-600">
                Obtained Refresh Token: {authState.refreshToken ? `${authState.refreshToken.substring(0, 15)}...` : 'N/A'}
                {/* Displaying only part of the token for safety */}
              </Typography>
            </div>
          )}

          {authState.status === 'expired' && (
            <div className="text-center space-y-3 p-4 bg-yellow-100 rounded">
              <Typography type="h4" className="text-yellow-800">Expired</Typography>
              <Typography className="text-yellow-700">The CLI authentication request has expired.</Typography>
            </div>
          )}
          {authState.status === 'used' && (
            <div className="text-center space-y-3 p-4 bg-yellow-100 rounded">
              <Typography type="h4" className="text-yellow-800">Already Used</Typography>
              <Typography className="text-yellow-700">This CLI authentication request has already been used.</Typography>
            </div>
          )}

          {authState.status === 'error' && (
            <div className="text-center space-y-3 p-4 bg-red-100 rounded">
              <Typography type="h4" className="text-red-800">Error</Typography>
              <Typography className="text-red-700">{authState.errorMessage || 'An unknown error occurred.'}</Typography>
            </div>
          )}
        </CardContent>
        <CardFooter className="flex justify-center">
          {['idle', 'error', 'expired', 'used', 'success'].includes(authState.status) && (
            <Button
              onClick={initiateCliAuth}
              disabled={authState.status === 'initiating'}
            >
              {authState.status === 'idle' ? 'Simulate CLI Login Initiation' : 'Start Again'}
            </Button>
          )}
          {(authState.status === 'waiting' || authState.status === 'polling') && (
            <Button
              onClick={resetState}
              variant='outline'
            >
              Cancel
            </Button>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}
