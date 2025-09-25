import Home from "./inner";
import { preloadQuery, preloadedQueryResult } from "convex/nextjs";
import { api } from "@/convex/_generated/api";

export default async function ServerPage() {
  const preloaded = await preloadQuery(api.myFunctions.listNumbers, {
    count: 3,
  });

  const data = preloadedQueryResult(preloaded);

  return (
    <main className="p-8 flex flex-col gap-4 mx-auto max-w-2xl">
      <h1 className="text-4xl font-bold text-center">Convex + Next.js</h1>
      <div className="flex flex-col gap-4 bg-slate-200 dark:bg-slate-800 p-4 rounded-md">
        <h2 className="text-xl font-bold">Non-reactive server-loaded data</h2>
        <code>
          <pre>{JSON.stringify(data, null, 2)}</pre>
        </code>
      </div>
      <Home preloaded={preloaded} />
    </main>
  );
}
