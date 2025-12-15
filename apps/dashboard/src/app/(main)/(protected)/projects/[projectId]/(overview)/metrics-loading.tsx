'use client';

import { CircleNotchIcon } from '@phosphor-icons/react';
import { Card, CardContent, cn } from '@stackframe/stack-ui';

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
