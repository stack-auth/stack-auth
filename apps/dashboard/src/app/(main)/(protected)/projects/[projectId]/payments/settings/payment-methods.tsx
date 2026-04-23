"use client";

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger, Switch, Typography } from "@/components/ui";
import { getPaymentMethodIcon } from "@/components/ui/payment-method-icons";
import { cn } from "@/lib/utils";
import { DesignBadge, DesignButton, DesignCard } from "@/components/design-components";
import { BankIcon, CircleNotchIcon, CreditCardIcon, CurrencyCircleDollarIcon, GlobeIcon, HandCoinsIcon, LightningIcon, ReceiptIcon, WalletIcon } from "@phosphor-icons/react";
import { getPaymentMethodCategory, PAYMENT_CATEGORIES, PAYMENT_METHOD_DEPENDENCIES, PaymentMethodCategory } from "@stackframe/stack-shared/dist/payments/payment-methods";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { useCallback, useEffect, useState } from "react";
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

export function PaymentMethods() {
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
    } finally {
      setLoading(false);
    }
  }, [adminApp]);

  useEffect(() => {
    runAsynchronouslyWithAlert(loadConfig);
  }, [loadConfig]);

  const handleToggle = (methodId: string, currentEnabled: boolean) => {
    setPendingChanges(prev => ({
      ...prev,
      [methodId]: !currentEnabled,
    }));
  };

  const hasPendingChanges = Object.keys(pendingChanges).length > 0;
  const [saving, setSaving] = useState(false);

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
      alert(validationError);
      return;
    }

    setSaving(true);
    try {
      const updates: Record<string, 'on' | 'off'> = {};
      for (const [methodId, enabled] of Object.entries(pendingChanges)) {
        updates[methodId] = enabled ? 'on' : 'off';
      }

      await adminApp.updatePaymentMethodConfigs(config.configId, updates);
      await loadConfig();
      setPendingChanges({});
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setPendingChanges({});
  };

  if (loading) {
    return (
      <DesignCard
        title="Payment Methods"
        subtitle="Configure which payment methods your customers can use at checkout."
        icon={CreditCardIcon}
        gradient="default"
      >
        <div className="flex flex-col items-center justify-center py-10 gap-3">
          <CircleNotchIcon className="h-6 w-6 animate-spin text-muted-foreground" />
          <Typography variant="secondary" className="text-sm">Loading payment methods…</Typography>
        </div>
      </DesignCard>
    );
  }

  if (!config) {
    return (
      <DesignCard
        title="Payment Methods"
        subtitle="Configure which payment methods your customers can use at checkout."
        icon={CreditCardIcon}
        gradient="default"
      >
        <div className="flex items-center justify-center py-10">
          <Typography variant="secondary" className="text-sm">Failed to load payment methods. Please try again.</Typography>
        </div>
      </DesignCard>
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
        className={cn(
          "flex items-center justify-between px-3 py-2.5 rounded-xl",
          "transition-colors duration-150 hover:transition-none",
          hasChanged
            ? "bg-blue-500/[0.08] dark:bg-blue-400/[0.08] ring-1 ring-blue-500/20 dark:ring-blue-400/20"
            : "hover:bg-foreground/[0.04]"
        )}
      >
        <div className="flex items-center gap-3 min-w-0">
          {BrandIcon ? (
            <BrandIcon iconSize={20} />
          ) : (
            <FallbackIcon className="h-5 w-5 text-muted-foreground" />
          )}
          <Typography className="text-sm font-medium text-foreground truncate">{method.name}</Typography>
          {hasChanged && (
            <DesignBadge label="Modified" color="blue" size="sm" />
          )}
        </div>
        <Switch
          checked={isEnabled}
          onCheckedChange={() => handleToggle(method.id, isEnabled)}
        />
      </div>
    );
  };

  const cardActions = hasPendingChanges ? (
    <div className="flex items-center gap-2">
      <DesignButton variant="secondary" size="sm" onClick={handleCancel} disabled={saving}>
        Cancel
      </DesignButton>
      <DesignButton size="sm" onClick={handleSave} loading={saving}>
        Save Changes
      </DesignButton>
    </div>
  ) : undefined;

  return (
    <div className="space-y-6">
      <DesignCard
        title="Payment Methods"
        subtitle="Configure which payment methods your customers can use at checkout. Some methods only appear for customers in specific regions, currencies, or transaction types."
        icon={CreditCardIcon}
        gradient="default"
        actions={cardActions}
      >
        {controllableMethods.length === 0 ? (
          <Typography variant="secondary" className="text-sm py-4">
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
                  className={cn("border-b border-border/40", isEmpty && "opacity-50")}
                  disabled={isEmpty}
                >
                  <AccordionTrigger
                    className="hover:no-underline py-3"
                    disabled={isEmpty}
                  >
                    <div className="flex items-center gap-3">
                      <CategoryIcon className="h-4 w-4 text-muted-foreground" weight="duotone" />
                      <span className="text-sm font-medium text-foreground">{category.name}</span>
                      <span className="text-[11px] text-muted-foreground">
                        ({category.methods.length})
                      </span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    {isEmpty ? (
                      <Typography variant="secondary" className="text-sm py-2">
                        No methods available in this category.
                      </Typography>
                    ) : (
                      <div className="space-y-1 pb-1">
                        {category.methods.map(renderMethodRow)}
                      </div>
                    )}
                  </AccordionContent>
                </AccordionItem>
              );
            })}

            {uncategorizedMethods.length > 0 && (
              <AccordionItem value="other" className="border-b border-border/40">
                <AccordionTrigger className="hover:no-underline py-3">
                  <div className="flex items-center gap-3">
                    <CreditCardIcon className="h-4 w-4 text-muted-foreground" weight="duotone" />
                    <span className="text-sm font-medium text-foreground">Other</span>
                    <span className="text-[11px] text-muted-foreground">
                      ({uncategorizedMethods.length})
                    </span>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-1 pb-1">
                    {uncategorizedMethods.map(renderMethodRow)}
                  </div>
                </AccordionContent>
              </AccordionItem>
            )}
          </Accordion>
        )}
      </DesignCard>

      {uncontrollableMethods.length > 0 && (
        <DesignCard
          title="Platform-Managed Methods"
          subtitle="These methods are controlled by the platform and cannot be customized."
          icon={GlobeIcon}
          gradient="default"
          className="opacity-70"
        >
          <div className="space-y-1">
            {uncontrollableMethods.slice(0, 10).map((method) => (
              <div
                key={method.id}
                className="flex items-center justify-between px-3 py-2.5 rounded-xl"
              >
                <Typography className="text-sm font-medium text-muted-foreground">
                  {method.name}
                </Typography>
                <Switch disabled checked={method.enabled} />
              </div>
            ))}
            {uncontrollableMethods.length > 10 && (
              <Typography variant="secondary" className="text-xs pt-2 px-3">
                And {uncontrollableMethods.length - 10} more…
              </Typography>
            )}
          </div>
        </DesignCard>
      )}
    </div>
  );
}
