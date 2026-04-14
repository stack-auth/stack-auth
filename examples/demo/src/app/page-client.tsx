'use client';

import { UserAvatar, useStackApp, useUser } from '@stackframe/stack';
import { Button, buttonVariants, Card, CardContent, CardFooter, CardHeader, Typography } from '@stackframe/stack-ui';
import Image from 'next/image';
import Link from 'next/link';

export default function PageClient() {
  const user = useUser({ includeRestricted: true });
  const app = useStackApp();

  const authButtons = (
    <div className='flex flex-col gap-5 justify-center items-center'>
      <Image src="/images/wave.png" alt="Wave" width={100} height={100} />
      <Typography type='h3'>Welcome to the Stack demo app!</Typography>
      <Typography>Try signing in/up with the buttons below!</Typography>
      <Typography>Also feel free to check out the things on the top right corner.</Typography>
      <div className='flex gap-2'>
        <Button onClick={async () => await app.redirectToSignIn()}>Sign In</Button>
        <Button onClick={async () => await app.redirectToSignUp()}>Sign Up</Button>
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
                <Button variant='destructive' onClick={async () => await app.redirectToSignOut()}>
                  Sign Out
                </Button>
              </div>
            </CardFooter>
          </Card>
        </div>
      ) : authButtons}
    </div>
  );
}
