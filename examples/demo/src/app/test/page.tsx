"use client";
import { useUser } from "@stackframe/stack";

export default function Test() {
  const provider = 'x';
  const user = useUser({ or: 'redirect' });
  const account = user.useConnectedAccount(provider, { or: 'redirect' });
  const key = account.useAccessToken();
  return <div>
    <div>
      <h1>{provider}</h1>
      <p>Key: {key.accessToken}</p>
    </div>
  </div>;
}
