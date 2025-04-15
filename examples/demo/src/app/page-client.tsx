'use client';

import { UserAvatar, useStackApp, useUser } from '@stackframe/stack';
import { Button, buttonVariants, Card, CardContent, CardFooter, CardHeader, Typography } from '@stackframe/stack-ui';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';


export default function PageClient() {
  const user = useUser();
  const router = useRouter();
  const app = useStackApp();

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
                  <Typography className='text-2xl font-semibold'>{user.displayName ?? user.primaryEmail}</Typography>
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
        </div>
      ) : authButtons}
    </div>
  );
}
