'use client';

import { createSupabaseClient } from "@/utils/supabase-client";
import { useStackApp, useUser } from "@stackframe/stack";
import { useEffect, useState } from "react";

export default function Page() {
  const app = useStackApp();
  const user = useUser();
  const supabase = createSupabaseClient();
  const [data, setData] = useState<null | any[]>(null);

  useEffect(() => {
    supabase.from("data").select().then(({ data }) => setData(data ?? []));
  }, []);

  const listContent = data === null ? 
    <p>Loading...</p> :
    data.length === 0 ?
      <p>No notes found</p> :
      data.map((note) => <li key={note.id}>{note.text}</li>);

  return (
    <div>
      {
        user ? 
        <>
          <p>You are signed in</p>
          <p>User ID: {user.id}</p>
          <button onClick={async () => await app.redirectToSignOut()}>Sign Out</button>
        </> : 
        <button onClick={async () => await app.redirectToSignIn()}>Sign In</button>
      }
      <h3>Supabase data</h3>
      <ul>{listContent}</ul>
    </div>
  )
}
