'use client';

import { UserAvatar, useStackApp, useUser } from '@stackframe/stack';
import { Button, buttonVariants, Card, CardContent, CardFooter, CardHeader, Typography } from '@stackframe/stack-ui';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

type LastTrackedEvent = {
  eventType: string,
  trackedAtIso: string,
};

type ServerApiResult = {
  status: 'idle' | 'loading' | 'success' | 'error',
  message?: string,
};

export default function PageClient() {
  const user = useUser({ includeRestricted: true });
  const router = useRouter();
  const app = useStackApp();
  const [lastTrackedEvent, setLastTrackedEvent] = useState<LastTrackedEvent | null>(null);
  const [serverApiResult, setServerApiResult] = useState<ServerApiResult>({ status: 'idle' });
  const [serverErrorResult, setServerErrorResult] = useState<ServerApiResult>({ status: 'idle' });
  const customEventsQuery = `SELECT * FROM default.events WHERE NOT startsWith(event_type, '$') ORDER BY event_at DESC LIMIT 20`;
  const lastTrackedEventQuery = lastTrackedEvent
    ? `SELECT event_at, event_type, user_id, team_id, data
FROM events
WHERE event_type = '${lastTrackedEvent.eventType}'
ORDER BY event_at DESC
LIMIT 20`
    : null;

  const authButtons = (
    <div className='flex flex-col gap-5 justify-center items-center'>
      <Image src="/images/wave.png" alt="Wave" width={100} height={100} />
      <Typography type='h3'>Welcome to the Stack demo app!</Typography>
      <Typography>Try signing in/up with the buttons below!</Typography>
      <Typography>Also feel free to check out the things on the top right corner.</Typography>
      <div className='flex gap-2'>
        <Button onClick={() => router.push(app.urls.signIn)}>Sign In</Button>
        <Button onClick={() => router.push(app.urls.signUp)}>Sign Up</Button>
      </div>
    </div>
  );

  return (
    <div className='flex flex-col items-center justify-center h-full w-full gap-10'>
      {user ? (
        <div className='flex flex-col gap-5 justify-center items-center'>
          <Card>
            <CardHeader>
              <div className='flex gap-6 items-center'>
                <UserAvatar user={user} size={100} />
                <div>
                  <Typography className='text-sm'>logged in as</Typography>
                  <div className="flex items-center gap-2">
                    <Typography className='text-2xl font-semibold'>{user.displayName ?? user.primaryEmail}</Typography>
                    {user.isRestricted && (
                      <span className="rounded bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 px-2 py-0.5 text-sm font-medium">
                        Restricted
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Typography>Click on your user&apos;s image at the top right to see your account settings.</Typography>
              <div className="mt-4 space-y-2">
                <Typography className="font-medium">User Information:</Typography>
                <div className="flex flex-col gap-2 text-sm">
                  <div className="flex">
                    <div className="w-32 font-semibold">User ID:</div>
                    <div className="font-mono">{user.id}</div>
                  </div>
                  {user.primaryEmail && (
                    <div className="flex">
                      <div className="w-32 font-semibold">Email:</div>
                      <div>{user.primaryEmail}</div>
                    </div>
                  )}
                  <div className="flex">
                    <div className="w-32 font-semibold">Restricted:</div>
                    <div>{user.isRestricted ? `Yes${user.restrictedReason ? ` (${user.restrictedReason.type})` : ''}` : 'No'}</div>
                  </div>
                </div>
              </div>
            </CardContent>
            <CardFooter>
              <div className='flex gap-2'>
                <Link href="https://app.stack-auth.com" className={buttonVariants()}>
                  Visit Stack Auth
                </Link>
                <Link href={app.urls.signOut} className={buttonVariants({ variant: 'destructive' })}>
                  Sign Out
                </Link>
              </div>
            </CardFooter>
          </Card>

          <Card className="w-full max-w-2xl">
            <CardHeader>
              <Typography type="h4">Custom analytics event demo</Typography>
              <Typography>
                Send a real custom event from this demo app, then paste the query below into Query Analytics.
              </Typography>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    onClick={async () => {
                      const trackedAtIso = new Date().toISOString();
                      const eventType = `demo.custom.${crypto.randomUUID()}`;
                      await app.trackEvent(eventType, {
                        source: "examples/demo",
                        tracked_at: trackedAtIso,
                        user_display_name: user.displayName ?? user.primaryEmail ?? user.id,
                      });
                      setLastTrackedEvent({ eventType, trackedAtIso });
                    }}
                  >
                    Send Custom Event
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => {
                      // Intentionally unhandled — triggers unhandledrejection which
                      // EventTracker captures as a $error event in all environments
                      // eslint-disable-next-line @typescript-eslint/no-floating-promises
                      Promise.reject(new Error(`Demo error ${crypto.randomUUID().slice(0, 8)}`));
                    }}
                  >
                    Trigger Error
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={serverApiResult.status === 'loading'}
                    onClick={async () => {
                      setServerApiResult({ status: 'loading' });
                      try {
                        const res = await fetch('/api/analytics-demo', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ action: 'button-click' }),
                        });
                        if (!res.ok) throw new Error(`HTTP ${res.status}`);
                        setServerApiResult({ status: 'success', message: `Tracked at ${new Date().toISOString()}` });
                      } catch (e) {
                        setServerApiResult({ status: 'error', message: String(e) });
                      }
                    }}
                  >
                    {serverApiResult.status === 'loading' ? 'Calling...' : 'Call Server API'}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={serverErrorResult.status === 'loading'}
                    onClick={async () => {
                      setServerErrorResult({ status: 'loading' });
                      try {
                        const res = await fetch('/api/analytics-demo', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ action: 'trigger-server-error' }),
                        });
                        const json = await res.json();
                        setServerErrorResult({
                          status: res.ok ? 'success' : 'error',
                          message: json.error ?? `HTTP ${res.status}`,
                        });
                      } catch (e) {
                        setServerErrorResult({ status: 'error', message: String(e) });
                      }
                    }}
                  >
                    {serverErrorResult.status === 'loading' ? 'Triggering...' : 'Trigger Server Error'}
                  </Button>
                  {serverErrorResult.status === 'error' && serverErrorResult.message && (
                    <Typography className="text-sm text-orange-600 dark:text-orange-400">
                      Server error tracked (linked to replay). {serverErrorResult.message}
                    </Typography>
                  )}
                  {lastTrackedEvent && (
                    <Typography className="text-sm">
                      Sent <span className="font-mono">{lastTrackedEvent.eventType}</span>
                    </Typography>
                  )}
                  {serverApiResult.status === 'success' && serverApiResult.message && (
                    <Typography className="text-sm text-green-600 dark:text-green-400">
                      Server event tracked. {serverApiResult.message}
                    </Typography>
                  )}
                  {serverApiResult.status === 'error' && serverApiResult.message && (
                    <Typography className="text-sm text-red-600 dark:text-red-400">
                      Error: {serverApiResult.message}
                    </Typography>
                  )}
                </div>

                <div className="rounded-md border bg-black/5 p-4 dark:bg-white/5">
                  <Typography className="mb-2 font-medium">Custom events (yours + server-side)</Typography>
                  <pre className="overflow-x-auto text-sm">{customEventsQuery}</pre>
                </div>

                {lastTrackedEvent && lastTrackedEventQuery && (
                  <div className="rounded-md border bg-black/5 p-4 dark:bg-white/5">
                    <Typography className="mb-2 font-medium">Query the event you just sent</Typography>
                    <pre className="overflow-x-auto text-sm">{lastTrackedEventQuery}</pre>
                    <Typography className="mt-2 text-sm">
                      Event timestamp: <span className="font-mono">{lastTrackedEvent.trackedAtIso}</span>
                    </Typography>
                  </div>
                )}

                <div className="rounded-md border bg-black/5 p-4 dark:bg-white/5">
                  <Typography className="mb-2 font-medium">Auto-captured events ($page-view, $click, etc.)</Typography>
                  <pre className="overflow-x-auto text-sm">{`SELECT event_at, event_type, data FROM default.events WHERE startsWith(event_type, '$') ORDER BY event_at DESC LIMIT 50`}</pre>
                </div>

                <div className="rounded-md border bg-black/5 p-4 dark:bg-white/5">
                  <Typography className="mb-2 font-medium">Errors with stack traces</Typography>
                  <pre className="overflow-x-auto text-sm">{`SELECT event_at, data.error_name, data.error_message, data.stack_frames, data.release FROM events WHERE event_type = '$error' ORDER BY event_at DESC LIMIT 20`}</pre>
                </div>

                <div className="rounded-md border bg-black/5 p-4 dark:bg-white/5">
                  <Typography className="mb-2 font-medium">Server errors linked to replays</Typography>
                  <pre className="overflow-x-auto text-sm">{`SELECT event_at, data.error_name, data.error_message, session_replay_id, session_replay_segment_id FROM events WHERE event_type = 'server.error' ORDER BY event_at DESC LIMIT 20`}</pre>
                </div>

              </div>
            </CardContent>
          </Card>
        </div>
      ) : authButtons}
    </div>
  );
}
