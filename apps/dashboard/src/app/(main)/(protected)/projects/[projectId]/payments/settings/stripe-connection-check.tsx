"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle, Typography } from "@/components/ui";

export function StripeConnectionCheck() {
  // TODO: Implement Stripe connection status check
  return (
    <Card>
      <CardHeader>
        <CardTitle>Stripe Connection</CardTitle>
        <CardDescription>
          Your Stripe account connection status.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Typography className="text-muted-foreground text-sm">
          Coming soon: View your Stripe connection status here.
        </Typography>
      </CardContent>
    </Card>
  );
}
