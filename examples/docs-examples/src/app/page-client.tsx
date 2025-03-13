'use client';

import { useStackApp, useUser } from '@stackframe/stack';
import { Button } from '@stackframe/stack-ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function PageClient() {
  const user = useUser();
  const router = useRouter();
  const app = useStackApp();

  const authButtons = (
    <div className='flex flex-col gap-5 justify-center items-center'>
      <div className='flex gap-5'>
        <Button onClick={() => router.push(app.urls.signIn)}>Sign In</Button>
        <Button onClick={() => router.push('/handler/signup')}>Sign Up</Button>
      </div>
    </div>
  );

  return (
    <div className='flex flex-col items-center justify-center h-full w-full gap-10'>
      {user ? (
        <div className='flex flex-col gap-5 justify-center items-center'>
          <Link href={app.urls.signOut}>
            Sign Out
          </Link>
        </div>
      ) : authButtons}
    </div>
  );
}
