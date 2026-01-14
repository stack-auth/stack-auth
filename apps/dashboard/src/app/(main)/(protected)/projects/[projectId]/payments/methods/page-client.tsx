"use client";

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Switch, toast, Typography } from "@/components/ui";
import { getPaymentMethodIcon } from "@/components/ui/payment-method-icons";
import { BankIcon, CircleNotchIcon, CreditCardIcon, CurrencyCircleDollarIcon, GlobeIcon, HandCoinsIcon, LightningIcon, ReceiptIcon, WalletIcon } from "@phosphor-icons/react";
import { getPaymentMethodCategory, PAYMENT_CATEGORIES, PAYMENT_METHOD_DEPENDENCIES, PaymentMethodCategory } from "@stackframe/stack-shared/dist/payments/payment-methods";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { useCallback, useEffect, useState } from "react";
import { PageLayout } from "../../page-layout";
import { useAdminApp } from "../../use-admin-app";

type PaymentMethod = {
  id: string,
  name: string,
  enabled: boolean,
  available: boolean,
  overridable: boolean,
};

type PaymentMethodConfig = {
  configId: string,
  methods: PaymentMethod[],
};

const CATEGORY_ICONS: Record<PaymentMethodCategory, typeof CreditCardIcon> = {
  cards: CreditCardIcon,
  wallets: WalletIcon,
  bnpl: HandCoinsIcon,
  realtime: LightningIcon,
  bank_debits: BankIcon,
  bank_transfers: CurrencyCircleDollarIcon,
  vouchers: ReceiptIcon,
};

const getCategoryFallbackIcon = (methodId: string) => {
  const category = getPaymentMethodCategory(methodId);
  if (category) {
    return CATEGORY_ICONS[category];
  }
  return GlobeIcon;
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
  const [saving, setSaving] = useState(false);

  // Get the effective state of a method (with pending changes applied)
  const getEffectiveState = (methodId: string): boolean => {
    if (methodId in pendingChanges) {
      return pendingChanges[methodId];
    }
    const method = config?.methods.find(m => m.id === methodId);
    return method?.enabled ?? false;
  };

  const validatePaymentMethodDependencies = (): string | null => {
    for (const [methodId, requiredMethods] of Object.entries(PAYMENT_METHOD_DEPENDENCIES)) {
      const methodEnabled = getEffectiveState(methodId);
      if (!methodEnabled) continue;

      const missingDeps = requiredMethods.filter(dep => !getEffectiveState(dep));
      if (missingDeps.length > 0) {
        const methodName = config?.methods.find(m => m.id === methodId)?.name ?? methodId;
        const depNames = missingDeps
          .map(dep => config?.methods.find(m => m.id === dep)?.name ?? dep)
          .join(', ');
        return `${methodName} requires ${depNames} to be enabled. Please enable ${depNames} or disable ${methodName} first.`;
      }
    }
    return null;
  };

  const handleSave = async () => {
    if (!config) return;

    const validationError = validatePaymentMethodDependencies();
    if (validationError) {
      toast({ title: "Invalid configuration", description: validationError, variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      const updates: Record<string, 'on' | 'off'> = {};
      for (const [methodId, enabled] of Object.entries(pendingChanges)) {
        updates[methodId] = enabled ? 'on' : 'off';
      }

      await adminApp.updatePaymentMethodConfigs(config.configId, updates);

      setPendingChanges({});
      try {
        await loadConfig();
      } catch {
        toast({ title: "Saved successfully", description: "But failed to refresh. Please reload the page.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Failed to save changes", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setPendingChanges({});
  };

  if (loading) {
    return (
      <PageLayout title="Payment Methods">
        <div className="flex flex-col items-center justify-center h-64 space-y-4">
          <CircleNotchIcon className="h-8 w-8 animate-spin text-primary" />
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

  const controllableMethods = config.methods.filter(m => m.overridable);
  const uncontrollableMethods = config.methods.filter(m => !m.overridable);

  const methodsByCategory = PAYMENT_CATEGORIES.map(category => {
    const methods = controllableMethods.filter(
      m => getPaymentMethodCategory(m.id) === category.id
    );
    const CategoryIcon = CATEGORY_ICONS[category.id];
    return { ...category, methods, icon: CategoryIcon };
  });

  const uncategorizedMethods = controllableMethods.filter(
    m => !getPaymentMethodCategory(m.id)
  );

  const renderMethodRow = (method: PaymentMethod) => {
    const isEnabled = method.id in pendingChanges ? pendingChanges[method.id] : method.enabled;
    const hasChanged = method.id in pendingChanges;
    const BrandIcon = getPaymentMethodIcon(method.id);
    const FallbackIcon = getCategoryFallbackIcon(method.id);

    return (
      <div
        key={method.id}
        className={`flex items-center justify-between p-3 rounded-lg transition-colors ${
          hasChanged ? 'bg-blue-50 dark:bg-blue-950/30' : 'hover:bg-muted/50'
        }`}
      >
        <div className="flex items-center gap-3">
          {BrandIcon ? (
            <BrandIcon iconSize={20} />
          ) : (
            <FallbackIcon className="h-5 w-5 text-muted-foreground" />
          )}
          <div>
            <Typography className="font-medium">{method.name}</Typography>
          </div>
        </div>
        <Switch
          checked={isEnabled}
          onCheckedChange={() => handleToggle(method.id, isEnabled)}
        />
      </div>
    );
  };

  return (
    <PageLayout title="Payment Methods">
      <div className="space-y-6 max-w-3xl">
        <div className="flex items-center justify-between">
          <div>
            <Typography variant="secondary" className="text-sm">
              Configure which payment methods your customers can use at checkout. Some methods only appear for customers in specific regions, currencies, or transaction types.
            </Typography>
          </div>
          {hasPendingChanges && (
            <div className="flex gap-2">
              <Button variant="secondary" onClick={handleCancel} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          )}
        </div>

        <Card>
          <CardContent>
            {controllableMethods.length === 0 ? (
              <Typography className="text-muted-foreground text-sm py-4">
                No payment methods are currently available. Complete Stripe onboarding to enable payment methods.
              </Typography>
            ) : (
              <Accordion type="multiple" className="w-full">
                {methodsByCategory.map(category => {
                  const CategoryIcon = category.icon;
                  const isEmpty = category.methods.length === 0;

                  return (
                    <AccordionItem
                      key={category.id}
                      value={category.id}
                      className={isEmpty ? 'opacity-50' : ''}
                      disabled={isEmpty}
                    >
                      <AccordionTrigger
                        className="hover:no-underline"
                        disabled={isEmpty}
                      >
                        <div className="flex items-center gap-3">
                          <CategoryIcon className="h-5 w-5 text-muted-foreground" weight="duotone" />
                          <span className="font-medium">{category.name}</span>
                          <span className="text-xs text-muted-foreground">
                            ({category.methods.length})
                          </span>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        {isEmpty ? (
                          <Typography className="text-muted-foreground text-sm py-2">
                            No methods available in this category.
                          </Typography>
                        ) : (
                          <div className="space-y-1">
                            {category.methods.map(renderMethodRow)}
                          </div>
                        )}
                      </AccordionContent>
                    </AccordionItem>
                  );
                })}

                {uncategorizedMethods.length > 0 && (
                  <AccordionItem value="other">
                    <AccordionTrigger className="hover:no-underline">
                      <div className="flex items-center gap-3">
                        <CreditCardIcon className="h-5 w-5 text-muted-foreground" />
                        <span className="font-medium">Other</span>
                        <span className="text-xs text-muted-foreground">
                          ({uncategorizedMethods.length})
                        </span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="space-y-1">
                        {uncategorizedMethods.map(renderMethodRow)}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                )}
              </Accordion>
            )}
          </CardContent>
        </Card>

        {uncontrollableMethods.length > 0 && (
          <Card className="opacity-60">
            <CardHeader>
              <CardTitle className="text-lg">Platform-Managed Methods</CardTitle>
              <CardDescription>
                These methods are controlled by the platform and cannot be customized.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-1">
              {uncontrollableMethods.slice(0, 10).map((method) => (
                <div
                  key={method.id}
                  className="flex items-center justify-between p-3 rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <Typography className="font-medium text-muted-foreground">{method.name}</Typography>
                  </div>
                  <Switch disabled checked={method.enabled} />
                </div>
              ))}
              {uncontrollableMethods.length > 10 && (
                <Typography className="text-muted-foreground text-sm pt-2">
                  And {uncontrollableMethods.length - 10} more...
                </Typography>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </PageLayout>
  );
}
