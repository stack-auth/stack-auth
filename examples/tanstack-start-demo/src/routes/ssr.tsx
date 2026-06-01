import { useUser } from "@hexclave/tanstack-start";
import { createFileRoute } from "@tanstack/react-router";
import { AuthDemoCard } from "~/components/auth-demo-card";

export const Route = createFileRoute("/ssr")({
  component: SsrAuthDemoPage,
});

const ssrSnippet = `import { useUser } from "@hexclave/tanstack-start";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/ssr")({
  component: SsrAuthDemoPage,
});

function SsrAuthDemoPage() {
  // This hook can suspend during SSR while Hexclave reads
  // the TanStack Start request cookies and fetches the user.
  const user = useUser({ includeRestricted: true });

  return <div>{user?.displayName ?? "Signed out"}</div>;
}`;

function SsrAuthDemoPage() {
  const user = useUser({ includeRestricted: true });

  return (
    <AuthDemoCard
      eyebrow="SSR route"
      title="Hexclave user fetched during server render"
      description="This route keeps SSR enabled. The Hexclave hook can resolve the current user from TanStack Start request cookies while React renders the route on the server."
      user={user}
      code={ssrSnippet}
    />
  );
}
