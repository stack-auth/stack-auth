import { stackAppInternalsSymbol } from '@stackframe/stack';
import { NextResponse } from 'next/server';
import { stackServerApp } from 'src/stack';

// This simulates the polling a CLI would do.
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { pollingCode } = body;

    if (!pollingCode) {
      return NextResponse.json(
        { error: 'pollingCode is required' },
        { status: 400 }
      );
    }

    // Call the internal Stack endpoint for polling: '/auth/cli/poll'
    // See the python example
    const appWithInternals = stackServerApp as any;
    const response = await appWithInternals[stackAppInternalsSymbol].sendRequest(
      '/auth/cli/poll',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          polling_code: pollingCode,
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Error polling CLI auth: ${response.status} ${errorText}`);
      // Don't return error here, as the endpoint uses status codes for flow control
      // Let the frontend interpret non-2xx status based on the contract
    }

    const pollData = await response.json();
    // Expected responses:
    // Status 200, { status: 'waiting' }
    // Status 201, { status: 'success', refresh_token: '...' }
    // Status 200, { status: 'expired' }
    // Status 200, { status: 'used' }
    // Other errors might return non-2xx which the frontend should handle

    // Return the status code as well, as it's meaningful (201 means success)
    return NextResponse.json(pollData, { status: response.status });

  } catch (error: any) {
    console.error('Error in /api/cli-auth/poll:', error);
    return NextResponse.json(
      { error: error.message || 'Internal Server Error' },
      { status: 500 }
    );
  }
}
