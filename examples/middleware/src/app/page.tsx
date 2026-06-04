import { stackServerApp } from "@/hexclave";
import Link from "next/link";

export default async function Home() {
  return (
    <main>
      Page 1 (not protected)<br />
      Current login status: {await stackServerApp.getUser() ? 'Logged in' : 'Not logged in'}<br />
      <Link href="/protected">Go to Page 2</Link>
    </main>
  );
}
