"use client";

import { StackClientApp } from "@stackframe/js";
import { useEffect, useState } from "react";

export default function DevToolTestJsPage() {
  const [status, setStatus] = useState("Initializing StackClientApp from @stackframe/js…");

  useEffect(() => {
    const app = new StackClientApp({
      projectId: "internal",
      publishableClientKey: "this-publishable-client-key-is-for-local-development-only",
      baseUrl: "http://localhost:8102",
      tokenStore: "cookie",
    });

    setStatus(`StackClientApp initialized (project: ${app.projectId}). Dev tool should appear at the bottom.`);
  }, []);

  return (
    <div style={{ padding: 40, maxWidth: 600, margin: "0 auto" }}>
      <h1 style={{ fontSize: 24, marginBottom: 16 }}>Dev Tool Test (@stackframe/js)</h1>
      <p style={{ marginBottom: 8 }}>
        This page creates a <code>StackClientApp</code> from <code>@stackframe/js</code>.
        The dev tool auto-mounts in the constructor (<code>js</code> platform path).
      </p>
      <p style={{ color: "#666" }}>{status}</p>
    </div>
  );
}
