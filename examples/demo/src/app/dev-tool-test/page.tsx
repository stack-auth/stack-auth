"use client";

import { useUser } from "@stackframe/stack";

export default function DevToolTestPage() {
  const user = useUser();

  return (
    <div style={{ padding: 40, maxWidth: 600, margin: "0 auto" }}>
      <h1 style={{ fontSize: 24, marginBottom: 16 }}>Dev Tool Test (Next.js page)</h1>
      <p style={{ marginBottom: 8 }}>
        This is a standard Next.js page rendered inside the root layout&apos;s{" "}
        <code>&lt;StackProvider&gt;</code>. The dev tool mounts via the{" "}
        <code>DevToolMount</code> React component (<code>react-like</code> platform path).
      </p>
      <p style={{ color: "#666" }}>
        Signed in as: {user?.primaryEmail ?? user?.displayName ?? "not signed in"}
      </p>
    </div>
  );
}
