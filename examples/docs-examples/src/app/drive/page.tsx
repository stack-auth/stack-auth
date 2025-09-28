'use client';

import { useUser } from "@stackframe/stack";
import { useEffect, useState } from 'react';

export default function Page() {
  const user = useUser({ or: 'redirect' });
  const account = user.useConnectedAccount('google', { or: 'redirect', scopes: ['https://www.googleapis.com/auth/drive.readonly'] });
  const tokens = account.useAccessToken();
  const [response, setResponse] = useState<any>();

  useEffect(() => {
    // eslint-disable-next-line no-restricted-syntax
    fetch('https://www.googleapis.com/drive/v3/files', {
      headers: { Authorization: `Bearer ${tokens.accessToken}` }
    })
      .then((res) => res.json())
      .then((data) => setResponse(data))
      .catch((err) => console.error(err));
  }, [tokens]);

  return <div>{response ? JSON.stringify(response) : 'Loading...'}</div>;
}
