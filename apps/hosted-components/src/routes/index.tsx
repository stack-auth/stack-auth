import { UserButton, useUser } from "@stackframe/react";
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  component: HandlerPage,
  pendingComponent: () => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
      <div style={{ width: 24, height: 24, border: "2px solid #e5e5e5", borderTop: "2px solid #333", borderRadius: "50%", animation: "spin 0.6s linear infinite" }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  ),
});

function HandlerPage() {
  const user = useUser({ or: "redirect" });
  const name = user.displayName || user.primaryEmail || "User";

  return (
    <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ position: "absolute", top: "1rem", right: "1rem" }}>
        <UserButton />
      </div>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 500, marginBottom: "0.5rem" }}>
        Welcome, {name}
      </h1>
      <p style={{ color: "#666", fontSize: "0.875rem" }}>
        You are signed in.
      </p>
    </div>
  );
}
