import { getNodeEnvironment } from "@stackframe/stack-shared/dist/utils/env";
import Link from "next/link";

export default function Home() {
  return (
    <div>
      Welcome to Hexclave&apos;s API endpoint.<br />
      <br />
      Were you looking for <Link href="https://app.hexclave.com">Hexclave&apos;s dashboard</Link> instead?<br />
      <br />
      You can also return to <Link href="https://hexclave.com">https://hexclave.com</Link>.<br />
      <br />
      <Link href="/api/v1">API v1</Link><br />
      {getNodeEnvironment() === "development" && (
        <>
          <br />
          <Link href="/dev-stats">Dev Stats</Link><br />
        </>
      )}
    </div>
  );
}
