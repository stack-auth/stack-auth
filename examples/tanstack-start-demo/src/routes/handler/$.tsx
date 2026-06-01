import { StackHandler } from "@hexclave/tanstack-start";
import { createFileRoute, useLocation } from "@tanstack/react-router";

export const Route = createFileRoute("/handler/$")({
  ssr: false,
  component: HandlerPage,
});

function HandlerPage() {
  const { pathname } = useLocation();
  return <StackHandler fullPage location={pathname} />;
}
