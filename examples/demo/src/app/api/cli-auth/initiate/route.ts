import { stackAppInternalsSymbol } from '@stackframe/stack';
import { NextResponse } from 'next/server';
import { stackServerApp } from 'src/stack';

// This simulates the first step a CLI would take.
export async function POST(request: Request) {
  try {
    // We are using an internal here bacause we are in the web, this is not intended.
    // For a node.js cli, use the function promptCliLogin
    // For python, look at the python example
    const appWithInternals = stackServerApp as any;
    const response = await appWithInternals[stackAppInternalsSymbol].sendRequest(
      '/auth/cli',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          // Optional: expires_in_millis can be set here
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Error initiating CLI auth: ${response.status} ${errorText}`);
      return NextResponse.json(
        { error: `Failed to initiate CLI auth: ${errorText}` },
        { status: response.status }
      );
    }

    const initData = await response.json();
    return NextResponse.json(initData);

  } catch (error: any) {
    console.error('Error in /api/cli-auth/initiate:', error);
    if (error?.message?.includes('Authentication required')) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    return NextResponse.json(
      { error: error.message || 'Internal Server Error' },
      { status: 500 }
    );
  }
}
