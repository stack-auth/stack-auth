import { createFileRoute } from '@tanstack/react-router';
import { StackHandler } from '@stackframe/react';
import { useState, useEffect } from 'react';

export const Route = createFileRoute('/handler/$')({
  component: HandlerPage,
});

function HandlerPage() {
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => setIsMounted(true), []);
  if (!isMounted) return null;
  return <StackHandler fullPage />;
}
