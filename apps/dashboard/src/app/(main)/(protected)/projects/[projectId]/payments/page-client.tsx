"use client";

import { SmartFormDialog } from "@/components/form-dialog";
import { SettingCard } from "@/components/settings";
import { Button, Typography } from "@stackframe/stack-ui";
import { WalletMinimal } from "lucide-react";
import { useState } from "react";
import * as yup from "yup";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";


export default function PageClient() {
  const stackAdminApp = useAdminApp();
  const [isStripeKeyDialogOpen, setIsStripeKeyDialogOpen] = useState(false);
  const [stripeConfigured, setStripeConfigured] = useState(false);

  return (
    <PageLayout
      title="Payments"
      description="Configure payment providers for your application"
      actions={
        <Button onClick={() => setIsStripeKeyDialogOpen(true)}>
          {stripeConfigured ? "Update Stripe Key" : "Configure Stripe"}
        </Button>
      }
    >
      <SettingCard
        title="Stripe"
        description={stripeConfigured ? "Configured and ready to use" : "Not configured"}
        actions={
          stripeConfigured ? (
            <Button variant="outline" onClick={() => setIsStripeKeyDialogOpen(true)}>
              Update Keys
            </Button>
          ) : (
            <Button onClick={() => setIsStripeKeyDialogOpen(true)}>Configure Stripe</Button>
          )
        }
      >
        {!stripeConfigured && (
          <div className="flex items-center gap-3">
            <WalletMinimal />
            <Typography>
              Connect your Stripe account to enable payment processing in your application.
            </Typography>
          </div>
        )}
      </SettingCard>

      <StripeKeyDialog
        open={isStripeKeyDialogOpen}
        onOpenChange={setIsStripeKeyDialogOpen}
        onKeyConfigured={() => setStripeConfigured(true)}
      />
    </PageLayout>
  );
}

function StripeKeyDialog(props: {
  open: boolean,
  onOpenChange: (open: boolean) => void,
  onKeyConfigured?: () => void,
}) {
  const stackAdminApp = useAdminApp();

  const formSchema = yup.object({
    stripeSecretKey: yup.string().defined().label("Stripe Secret Key"),
    stripePublishableKey: yup.string().defined().label("Stripe Publishable Key"),
    stripeWebhookSecret: yup.string().label("Stripe Webhook Secret (optional)")
  });

  return (
    <SmartFormDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title="Configure Stripe"
      formSchema={formSchema}
      okButton={{ label: "Save" }}
      onSubmit={async (values) => {
        // In a real implementation, this would save the keys to your project configuration
        // For example: await stackAdminApp.setStripeConfig({ ... })
        console.log("Stripe keys configured:", values);

        // Mock implementation - just notify parent component that keys were configured
        props.onKeyConfigured?.();
      }}
      cancelButton
    />
  );
}
