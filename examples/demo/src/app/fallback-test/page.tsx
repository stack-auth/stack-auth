import { stackServerApp } from "src/stack";
import { FallbackTestClient } from "./client";

export default async function FallbackTestPage() {
  const serverStart = Date.now();
  const user = await stackServerApp.getUser();
  const project = await stackServerApp.getProject();
  const serverDuration = Date.now() - serverStart;

  return (
    <div style={{ fontFamily: "monospace", padding: 32, maxWidth: 900 }}>
      <h1>SDK Fallback Test</h1>

      <section style={{ marginBottom: 24, padding: 16, background: "#f5f5f5", borderRadius: 8 }}>
        <h2 style={{ marginTop: 0 }}>Server-side (RSC)</h2>
        <pre>{JSON.stringify({ projectId: project.id, projectName: project.displayName, user: user?.primaryEmail ?? user?.id ?? null, duration: `${serverDuration}ms` }, null, 2)}</pre>
      </section>

      <FallbackTestClient />
    </div>
  );
}
