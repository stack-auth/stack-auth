"use client";
import { useUser } from "@stackframe/stack";
import { useEffect, useState } from "react";

export default function Test() {
  const user = useUser({ or: 'redirect' });
  const account = user.useConnectedAccount('google', { or: 'redirect', scopes: ['https://www.googleapis.com/auth/gmail.readonly'] });
  const key = account.useAccessToken();
  const [inbox, setInbox] = useState<any>(null);
  const [googleAccount, setGoogleAccount] = useState<any>(null);

  useEffect(() => {
    // eslint-disable-next-line
    fetch('https://www.googleapis.com/gmail/v1/users/me/messages', {
      headers: { Authorization: `Bearer ${key.accessToken}` }
    })
      .then(res => res.json())
      .then(data => setInbox(data))
      .catch(err => console.error(err));
  }, [key]);

  useEffect(() => {
    // eslint-disable-next-line
    fetch('https://www.googleapis.com/oauth2/v1/userinfo', {
      headers: { Authorization: `Bearer ${key.accessToken}` }
    })
      .then(res => res.json())
      .then(data => setGoogleAccount(data))
      .catch(err => console.error(err));
  }, [key]);

  return <div>
    <div className="flex flex-col gap-4 p-8">
      <h1 className="text-2xl font-bold">Gmail API Example</h1>
      <p className="text-lg">Your account: {JSON.stringify(googleAccount, null, 2)}</p>
      <p className="text-lg">Your inbox:</p>
      <pre className="text-sm">{JSON.stringify(inbox, null, 2)}</pre>
    </div>
  </div>;
}
