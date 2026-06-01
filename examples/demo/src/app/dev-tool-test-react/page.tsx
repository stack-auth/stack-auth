"use client";

import { StackClientApp, StackProvider, useUser } from "@hexclave/react";
import { Suspense } from "react";

const app = new StackClientApp({
  projectId: "internal",
  publishableClientKey: "this-publishable-client-key-is-for-local-development-only",
  baseUrl: "http://localhost:8102",
  tokenStore: "cookie",
});

function Status() {
  const user = useUser();
  return (
    <p style={{ color: "#666" }}>
      Signed in as: {user?.primaryEmail ?? user?.displayName ?? "not signed in"}
    </p>
  );
}

export default function DevToolTestReactPage() {
  return (
    <StackProvider app={app}>
      <div style={{ padding: 40, maxWidth: 600, margin: "0 auto" }}>
        <h1 style={{ fontSize: 24, marginBottom: 16 }}>Dev Tool Test (@hexclave/react)</h1>
        <p style={{ marginBottom: 8 }}>
          This page creates its own <code>StackProvider</code> from <code>@hexclave/react</code>.
          The dev tool mounts via the <code>DevToolMount</code> component (<code>react-like</code> platform path).
        </p>
        <Suspense fallback={<p style={{ color: "#666" }}>Loading user…</p>}>
          <Status />
        </Suspense>
      </div>
    </StackProvider>
  );
}
