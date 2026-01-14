"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle, Typography } from "@/components/ui";

export function TestModeToggle() {
  // TODO: Implement test mode toggle
  return (
    <Card>
      <CardHeader>
        <CardTitle>Test Mode</CardTitle>
        <CardDescription>
          Switch between test and live payment environments.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Typography className="text-muted-foreground text-sm">
          Coming soon: Toggle between Stripe test and live modes here.
        </Typography>
      </CardContent>
    </Card>
  );
}
