"use client";

import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Switch, Typography } from "@/components/ui";
import { Building, CreditCard, Globe, Wallet } from "@phosphor-icons/react";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { useCallback, useEffect, useState } from "react";
import { PageLayout } from "../../page-layout";
import { useAdminApp } from "../../use-admin-app";

type PaymentMethod = {
  id: string,
  name: string,
  enabled: boolean,
  available: boolean,
};

type PaymentMethodConfig = {
  configId: string,
  methods: PaymentMethod[],
};

// Icons for different payment method categories
const getMethodIcon = (id: string) => {
  if (['card', 'cartes_bancaires'].includes(id)) return CreditCard;
  if (['apple_pay', 'google_pay', 'link', 'amazon_pay', 'cashapp'].includes(id)) return Wallet;
  if (['us_bank_account', 'sepa_debit', 'bacs_debit', 'acss_debit'].includes(id)) return Building;
  return Globe;
};

export default function PageClient() {
  const adminApp = useAdminApp();
  const [config, setConfig] = useState<PaymentMethodConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingChanges, setPendingChanges] = useState<Record<string, boolean>>({});

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const result = await adminApp.getPaymentMethodConfigs();
      if (result) {
        setConfig(result as PaymentMethodConfig);
      }
    } catch (error) {
      console.error("Failed to load payment method configs:", error);
    } finally {
      setLoading(false);
    }
  }, [adminApp]);

  useEffect(() => {
    runAsynchronously(loadConfig);
  }, [loadConfig]);

  const handleToggle = (methodId: string, currentEnabled: boolean) => {
    setPendingChanges(prev => ({
      ...prev,
      [methodId]: !currentEnabled,
    }));
  };

  const hasPendingChanges = Object.keys(pendingChanges).length > 0;

  const handleSave = async () => {
    // TODO: Implement save functionality with PATCH endpoint
    console.log("Saving changes:", pendingChanges);
    alert("Save functionality coming soon! Changes: " + JSON.stringify(pendingChanges));
  };

  const handleCancel = () => {
    setPendingChanges({});
  };

  if (loading) {
    return (
      <PageLayout title="Payment Methods">
        <div className="flex items-center justify-center h-64">
          <Typography className="text-muted-foreground">Loading payment methods...</Typography>
        </div>
      </PageLayout>
    );
  }

  if (!config) {
    return (
      <PageLayout title="Payment Methods">
        <div className="flex items-center justify-center h-64">
          <Typography className="text-muted-foreground">Failed to load payment methods. Please try again.</Typography>
        </div>
      </PageLayout>
    );
  }

  const availableMethods = config.methods.filter(m => m.available);
  const unavailableMethods = config.methods.filter(m => !m.available);

  return (
    <PageLayout title="Payment Methods">
      <div className="space-y-6 max-w-3xl">
        <div className="flex items-center justify-between">
          <div>
            <Typography variant="secondary" className="text-sm">
              Configure which payment methods your customers can use at checkout.
            </Typography>
          </div>
          {hasPendingChanges && (
            <div className="flex gap-2">
              <Button variant="secondary" onClick={handleCancel}>
                Cancel
              </Button>
              <Button onClick={handleSave}>
                Save Changes
              </Button>
            </div>
          )}
        </div>

        {/* Available Payment Methods */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Available Methods</CardTitle>
            <CardDescription>
              These payment methods are active and can be enabled for your customers.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            {availableMethods.length === 0 ? (
              <Typography className="text-muted-foreground text-sm py-4">
                No payment methods are currently available. Complete Stripe onboarding to enable payment methods.
              </Typography>
            ) : (
              availableMethods.map((method) => {
                const Icon = getMethodIcon(method.id);
                const isEnabled = method.id in pendingChanges ? pendingChanges[method.id] : method.enabled;
                const hasChanged = method.id in pendingChanges;

                return (
                  <div
                    key={method.id}
                    className={`flex items-center justify-between p-3 rounded-lg transition-colors ${
                      hasChanged ? 'bg-blue-50 dark:bg-blue-950/30' : 'hover:bg-muted/50'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Icon className="h-5 w-5 text-muted-foreground" />
                      <div>
                        <Typography className="font-medium">{method.name}</Typography>
                        <Typography variant="secondary" className="text-xs">
                          {method.id}
                        </Typography>
                      </div>
                    </div>
                    <Switch
                      checked={isEnabled}
                      onCheckedChange={() => handleToggle(method.id, method.enabled)}
                    />
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        {/* Unavailable Payment Methods */}
        {unavailableMethods.length > 0 && (
          <Card className="opacity-60">
            <CardHeader>
              <CardTitle className="text-lg">Unavailable Methods</CardTitle>
              <CardDescription>
                These methods require additional setup or verification in Stripe before they can be enabled.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-1">
              {unavailableMethods.slice(0, 10).map((method) => {
                const Icon = getMethodIcon(method.id);
                return (
                  <div
                    key={method.id}
                    className="flex items-center justify-between p-3 rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      <Icon className="h-5 w-5 text-muted-foreground/50" />
                      <div>
                        <Typography className="font-medium text-muted-foreground">{method.name}</Typography>
                      </div>
                    </div>
                    <Switch disabled checked={false} />
                  </div>
                );
              })}
              {unavailableMethods.length > 10 && (
                <Typography className="text-muted-foreground text-sm pt-2">
                  And {unavailableMethods.length - 10} more...
                </Typography>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </PageLayout>
  );
}
