import { createFileRoute } from '@tanstack/react-router';
import { StackHandler } from '@stackframe/react';

export const Route = createFileRoute('/handler/$')({
  component: HandlerPage,
});

function HandlerPage() {
  return <StackHandler fullPage />;
}
