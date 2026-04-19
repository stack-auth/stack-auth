'use client';

import { Button, Card, CardContent, cn } from '@/components/ui';
import { captureError } from '@stackframe/stack-shared/dist/utils/errors';
import { ArrowClockwiseIcon, CircleNotchIcon, WarningCircleIcon } from '@phosphor-icons/react';

const capturedMetricsErrors = new WeakSet<Error>();

function captureMetricsErrorOnce(error: Error) {
  if (capturedMetricsErrors.has(error)) {
    return;
  }
  capturedMetricsErrors.add(error);
  captureError("metrics-page-error-boundary", error);
}

export function MetricsLoadingFallback({ className }: { className?: string }) {
  return (
    <Card className={cn("w-full", className)}>
      <CardContent className="flex flex-col items-center justify-center py-12 space-y-4">
        <CircleNotchIcon className="h-8 w-8 animate-spin text-primary" />
        <div className="text-center space-y-1">
          <p className="text-lg font-medium">Recalculating metrics...</p>
          <p className="text-sm text-muted-foreground">Please check back later</p>
        </div>
      </CardContent>
    </Card>
  );
}

export function MetricsErrorFallback({
  error,
  onRetryAction,
  className,
}: {
  error: Error,
  onRetryAction?: () => void,
  className?: string,
}) {
  captureMetricsErrorOnce(error);

  const errorMessage = error.message.trim().length > 0
    ? error.message
    : "An unexpected error occurred while loading project metrics.";

  return (
    <Card className={cn("w-full", className)}>
      <CardContent className="flex flex-col items-center justify-center py-12 space-y-4 text-center">
        <WarningCircleIcon className="h-8 w-8 text-destructive" />
        <div className="space-y-1">
          <p className="text-lg font-medium">Failed to load metrics</p>
          <p className="text-sm text-muted-foreground">{errorMessage}</p>
        </div>
        {onRetryAction != null ? (
          <Button variant="secondary" size="sm" onClick={onRetryAction}>
            <ArrowClockwiseIcon className="mr-1.5 h-4 w-4" />
            Try again
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
