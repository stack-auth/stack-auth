"use client";

import { useAction } from "convex/react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import { useUser } from "@stackframe/stack";

export default function Page() {
  const myAction = useAction(api.myActions.myAction);
  const user = useUser({ or: "redirect" });
  const [data, setData] = useState<string | null>(null);


  return (
    <div className="flex flex-col gap-8 max-w-lg mx-auto pt-10">
      <div className="flex flex-col gap-4 bg-slate-200 dark:bg-slate-800 p-4 rounded-md">
        <h2 className="text-xl font-bold">User read-only metadata</h2>
        <code>
          <pre>{JSON.stringify(user.clientReadOnlyMetadata, null, 2)}</pre>
        </code>
      </div>
      <input type="text" placeholder="test 123" className="border border-slate-300 rounded-md p-2" onChange={(e) => setData(e.target.value)} />
      <button
        className="bg-foreground text-background text-sm px-4 py-2 rounded-md"
        onClick={async () => {
          await myAction({ testMetadata: data ?? "" })
          alert("User's client read-only metadata updated, refresh to see changes")
        }}
      >
        My Action
      </button>
    </div>
  )
}
