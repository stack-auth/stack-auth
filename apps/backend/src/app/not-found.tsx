import { connection } from "next/server";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

export default async function NotFound() {
  await connection();  // guarantees we will never prerender

  return <div>
    404 Not Found
  </div>;
}
