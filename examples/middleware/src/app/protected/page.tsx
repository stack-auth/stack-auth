import { stackServerApp } from "@/hexclave";
import Link from "next/link";

export default function Home() {
  return (
    <main>
      Page 2 (protected by middleware)<br />
      <Link href="/handler/signout">Sign out</Link><br />
      <Link href="/">Go to Page 1</Link>
    </main>
  );
}
