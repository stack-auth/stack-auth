import { useUser } from "@stackframe/tanstack-start";
import { createFileRoute } from "@tanstack/react-router";
import { AuthDemoCard } from "~/components/auth-demo-card";

export const Route = createFileRoute("/client")({
  ssr: false,
  component: ClientAuthDemoPage,
});

const clientSnippet = `import { useUser } from "@stackframe/tanstack-start";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/client")({
  ssr: false,
  component: ClientAuthDemoPage,
});

function ClientAuthDemoPage() {
  // This route is skipped during SSR. The user is resolved
  // in the browser from the client token store.
  const user = useUser({ includeRestricted: true });

  return <div>{user?.displayName ?? "Signed out"}</div>;
}`;

function ClientAuthDemoPage() {
  const user = useUser({ includeRestricted: true });

  return (
    <AuthDemoCard
      eyebrow="Client-only route"
      title="Hexclave user fetched in the browser"
      description="This route opts out of SSR with ssr: false. The UI is rendered on the client, and Hexclave resolves the current user from the browser token store."
      user={user}
      code={clientSnippet}
    />
  );
}
