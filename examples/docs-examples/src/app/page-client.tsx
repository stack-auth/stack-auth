'use client';

import { useStackApp, useUser } from '@stackframe/stack';
import { Button } from '@stackframe/stack-ui';

export default function PageClient() {
  const user = useUser();
  const app = useStackApp();

  const authButtons = (
    <div className='flex flex-col gap-5 justify-center items-center'>
      <div className='flex gap-5'>
        <Button onClick={async () => await app.redirectToSignIn()}>Sign In</Button>
        <Button onClick={async () => await app.redirectToSignUp()}>Sign Up</Button>
      </div>
    </div>
  );

  return (
    <div className='flex flex-col items-center justify-center h-full w-full gap-10'>
      {user ? (
        <div className='flex flex-col gap-5 justify-center items-center'>
          <Button variant="secondary" onClick={async () => await app.redirectToSignOut()}>
            Sign Out
          </Button>
        </div>
      ) : authButtons}
    </div>
  );
}
