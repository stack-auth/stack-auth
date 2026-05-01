import { useEffect, useMemo, useState } from "react"
import { Link, createFileRoute } from "@tanstack/react-router"
import { useMutation, useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  ArrowSquareOutIcon,
  BankIcon,
  CircleNotchIcon,
  CreditCardIcon,
  CurrencyCircleDollarIcon,
  FlaskIcon,
  GlobeIcon,
  HandCoinsIcon,
  LightningIcon,
  PlugIcon,
  ProhibitIcon,
  ReceiptIcon,
  WalletIcon,
} from "@phosphor-icons/react"
import {
  PAYMENT_CATEGORIES,
  PAYMENT_METHOD_DEPENDENCIES,
  getPaymentMethodCategory,
} from "@stackframe/stack-shared/dist/payments/payment-methods"
import type { PaymentMethodCategory } from "@stackframe/stack-shared/dist/payments/payment-methods"

import { useAdminApp } from "@/lib/stack/admin-app"
import {
  useAdminProject,
  useLoadedAdminProjectConfig,
  useStackAuthQueryInvalidation,
  useStripeAccountInfoQuery,
} from "@/lib/stack/react-query"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { ProjectPageMain } from "@/components/console/project-page"
import { cn } from "@/lib/utils"

export const Route = createFileRoute("/_app/projects/$projectId/payments/settings")({
  component: SettingsPage,
})

function SettingsPage() {
  return (
    <ProjectPageMain className="space-y-6">
      <StripeConnectionCard />
      <TestModeCard />
      <PaymentMethodsCard />
      <BlockNewPurchasesCard />
    </ProjectPageMain>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Stripe connection
// ──────────────────────────────────────────────────────────────────────────

function StripeConnectionCard() {
  const adminApp = useAdminApp()
  const stripeAccountQuery = useStripeAccountInfoQuery(adminApp)
  const account = stripeAccountQuery.data ?? null

  const setupMutation = useMutation({
    mutationFn: () => adminApp.setupPayments(),
    onSuccess: ({ url }) => {
      window.location.href = url
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to start Stripe onboarding.")
    },
  })

  return (
    <section className="rounded-lg border bg-card">
      <div className="flex items-center justify-between gap-4 border-b px-5 py-4">
        <div>
          <h2 className="font-heading text-sm font-semibold">Stripe connection</h2>
          <p className="text-xs text-muted-foreground">
            Manage your Stripe account link and onboarding state.
          </p>
        </div>
        {stripeAccountQuery.isPending ? (
          <Skeleton className="h-5 w-20" />
        ) : (
          <Badge variant={account?.charges_enabled ? "default" : "secondary"}>
            {account == null ? "Disconnected" : account.charges_enabled ? "Active" : "Pending"}
          </Badge>
        )}
      </div>
      <div className="px-5 py-5">
        {account == null ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Connect Stripe to start charging customers.
            </p>
            <Button
              size="sm"
              onClick={async () => {
                await setupMutation.mutateAsync()
              }}
              disabled={setupMutation.isPending}
            >
              <PlugIcon />
              {setupMutation.isPending ? "Redirecting…" : "Connect Stripe"}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-3">
              <StatusChip label="Charges" enabled={account.charges_enabled} />
              <StatusChip label="Details" enabled={account.details_submitted} />
              <StatusChip label="Payouts" enabled={account.payouts_enabled} />
            </div>
            {!account.details_submitted && (
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  await setupMutation.mutateAsync()
                }}
                disabled={setupMutation.isPending}
              >
                Complete onboarding
                <ArrowSquareOutIcon />
              </Button>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

function StatusChip({ label, enabled }: { label: string, enabled: boolean }) {
  return (
    <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-2">
      <span
        aria-hidden
        className={"size-2 rounded-full " + (enabled ? "bg-success" : "bg-destructive")}
      />
      <span className="text-xs">{label}</span>
      <span className="ms-auto font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
        {enabled ? "On" : "Off"}
      </span>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Test mode
// ──────────────────────────────────────────────────────────────────────────

function TestModeCard() {
  const project = useAdminProject()
  const config = useLoadedAdminProjectConfig(project)
  const { invalidateProjectConfig } = useStackAuthQueryInvalidation()
  const enabled = Boolean((config as { payments?: { testMode?: boolean } }).payments?.testMode)
  const [pending, setPending] = useState<boolean | null>(null)

  const handleToggle = async (next: boolean) => {
    setPending(next)
    try {
      await project.updateConfig({ "payments.testMode": next })
      await invalidateProjectConfig(project.id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update test mode.")
    } finally {
      setPending(null)
    }
  }

  const display = pending ?? enabled

  return (
    <section className="rounded-lg border bg-card">
      <div className="border-b px-5 py-4">
        <h2 className="font-heading text-sm font-semibold">Test mode</h2>
        <p className="text-xs text-muted-foreground">
          Switch between test and live payment environments.
        </p>
      </div>
      <div className="px-5 py-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-md border",
                display ? "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300" : "bg-background text-muted-foreground"
              )}
            >
              <FlaskIcon />
            </span>
            <div className="space-y-1">
              <p className="text-sm font-medium">
                {display ? "Test mode is active" : "Test mode is disabled"}
              </p>
              <p className="text-xs text-muted-foreground">
                {display
                  ? "All checkouts are bypassed and no real payments are processed."
                  : "Checkouts process real payments through Stripe."}
              </p>
            </div>
          </div>
          <Switch
            checked={display}
            disabled={pending != null}
            onCheckedChange={(next) => {
              void handleToggle(next)
            }}
          />
        </div>

        {display && (
          <div className="mt-4 flex flex-wrap gap-2">
            {["No credit card required", "Products granted instantly", "No Stripe transactions"].map((label) => (
              <span
                key={label}
                className="inline-flex items-center rounded-md bg-blue-500/10 px-2 py-0.5 font-mono text-[10px] tracking-wider text-blue-700 uppercase ring-1 ring-blue-500/20 dark:text-blue-300 dark:ring-blue-400/20"
              >
                {label}
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Payment methods
// ──────────────────────────────────────────────────────────────────────────

type PaymentMethod = {
  id: string,
  name: string,
  enabled: boolean,
  available: boolean,
  overridable: boolean,
}

type PaymentMethodConfig = {
  configId: string,
  methods: Array<PaymentMethod>,
}

const CATEGORY_ICONS: Record<PaymentMethodCategory, typeof CreditCardIcon> = {
  cards: CreditCardIcon,
  wallets: WalletIcon,
  bnpl: HandCoinsIcon,
  realtime: LightningIcon,
  bank_debits: BankIcon,
  bank_transfers: CurrencyCircleDollarIcon,
  vouchers: ReceiptIcon,
}

function PaymentMethodsCard() {
  const adminApp = useAdminApp()
  const stripeAccountQuery = useStripeAccountInfoQuery(adminApp)
  const isStripeConnected = stripeAccountQuery.data != null

  const query = useQuery({
    queryKey: ["payments", "method-configs", adminApp.projectId] as const,
    queryFn: () => adminApp.getPaymentMethodConfigs() as Promise<PaymentMethodConfig | null>,
    enabled: isStripeConnected,
  })

  const [pendingChanges, setPendingChanges] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setPendingChanges({})
  }, [query.data?.configId])

  const config = query.data ?? null

  const getEffectiveState = (methodId: string): boolean => {
    if (methodId in pendingChanges) return pendingChanges[methodId]
    return config?.methods.find((m) => m.id === methodId)?.enabled ?? false
  }

  const validateDeps = (): string | null => {
    for (const [methodId, requiredMethods] of Object.entries(PAYMENT_METHOD_DEPENDENCIES)) {
      if (!getEffectiveState(methodId)) continue
      const missing = requiredMethods.filter((dep) => !getEffectiveState(dep))
      if (missing.length > 0) {
        const name = config?.methods.find((m) => m.id === methodId)?.name ?? methodId
        const depNames = missing
          .map((dep) => config?.methods.find((m) => m.id === dep)?.name ?? dep)
          .join(", ")
        return `${name} requires ${depNames}. Enable ${depNames} or disable ${name}.`
      }
    }
    return null
  }

  const hasPending = Object.keys(pendingChanges).length > 0

  const handleSave = async () => {
    if (config == null) return
    const err = validateDeps()
    if (err != null) {
      toast.error(err)
      return
    }
    setSaving(true)
    try {
      const updates: Record<string, "on" | "off"> = {}
      for (const [methodId, enabled] of Object.entries(pendingChanges)) {
        updates[methodId] = enabled ? "on" : "off"
      }
      await adminApp.updatePaymentMethodConfigs(config.configId, updates)
      await query.refetch()
      setPendingChanges({})
      toast.success("Payment methods updated.")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update payment methods.")
    } finally {
      setSaving(false)
    }
  }

  const controllable = useMemo(
    () => (config?.methods ?? []).filter((m) => m.overridable),
    [config?.methods]
  )

  const byCategory = useMemo(
    () =>
      PAYMENT_CATEGORIES.map((category) => ({
        ...category,
        Icon: CATEGORY_ICONS[category.id],
        methods: controllable.filter((m) => getPaymentMethodCategory(m.id) === category.id),
      })),
    [controllable]
  )

  const uncategorized = useMemo(
    () => controllable.filter((m) => getPaymentMethodCategory(m.id) == null),
    [controllable]
  )

  return (
    <section className="rounded-lg border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
        <div>
          <h2 className="font-heading text-sm font-semibold">Payment methods</h2>
          <p className="text-xs text-muted-foreground">
            Choose which payment methods are offered at checkout.
          </p>
        </div>
        {hasPending && (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPendingChanges({})}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => {
                void handleSave()
              }}
              disabled={saving}
            >
              {saving ? "Saving…" : `Save ${Object.keys(pendingChanges).length} change${Object.keys(pendingChanges).length === 1 ? "" : "s"}`}
            </Button>
          </div>
        )}
      </div>

      <div className="px-5 py-5">
        {!isStripeConnected ? (
          <p className="text-xs text-muted-foreground">
            Connect Stripe to manage payment methods.
          </p>
        ) : query.isPending ? (
          <div className="flex h-24 items-center justify-center gap-2 text-xs text-muted-foreground">
            <CircleNotchIcon className="size-4 animate-spin" />
            Loading payment methods…
          </div>
        ) : query.isError ? (
          <Alert variant="destructive">
            <AlertTitle>Could not load payment methods</AlertTitle>
            <AlertDescription>
              {query.error instanceof Error ? query.error.message : "Unknown error."}
            </AlertDescription>
          </Alert>
        ) : config == null ? (
          <p className="text-xs text-muted-foreground">
            Payment method configuration is not available yet. Finish Stripe onboarding to manage payment methods.
          </p>
        ) : controllable.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No configurable payment methods are available for this account.
          </p>
        ) : (
          <Accordion>
            {byCategory.map((cat) => {
              const Icon = cat.Icon
              const empty = cat.methods.length === 0
              return (
                <AccordionItem key={cat.id} value={cat.id} disabled={empty}>
                  <AccordionTrigger className={cn(empty && "opacity-50")}>
                    <div className="flex min-w-0 items-center gap-3">
                      <Icon className="size-4 text-muted-foreground" />
                      <span className="text-sm font-medium">{cat.name}</span>
                      <span className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
                        {cat.methods.length}
                      </span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    {empty ? (
                      <p className="px-2 py-2 text-xs text-muted-foreground">
                        No methods available in this category.
                      </p>
                    ) : (
                      <ul className="divide-y">
                        {cat.methods.map((method) => (
                          <MethodRow
                            key={method.id}
                            method={method}
                            pendingChanges={pendingChanges}
                            onToggle={(next) =>
                              setPendingChanges((prev) => {
                                const copy = { ...prev }
                                if (next === method.enabled) {
                                  delete copy[method.id]
                                } else {
                                  copy[method.id] = next
                                }
                                return copy
                              })
                            }
                          />
                        ))}
                      </ul>
                    )}
                  </AccordionContent>
                </AccordionItem>
              )
            })}
            {uncategorized.length > 0 && (
              <AccordionItem value="other">
                <AccordionTrigger>
                  <div className="flex min-w-0 items-center gap-3">
                    <GlobeIcon className="size-4 text-muted-foreground" />
                    <span className="text-sm font-medium">Other</span>
                    <span className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
                      {uncategorized.length}
                    </span>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <ul className="divide-y">
                    {uncategorized.map((method) => (
                      <MethodRow
                        key={method.id}
                        method={method}
                        pendingChanges={pendingChanges}
                        onToggle={(next) =>
                          setPendingChanges((prev) => {
                            const copy = { ...prev }
                            if (next === method.enabled) {
                              delete copy[method.id]
                            } else {
                              copy[method.id] = next
                            }
                            return copy
                          })
                        }
                      />
                    ))}
                  </ul>
                </AccordionContent>
              </AccordionItem>
            )}
          </Accordion>
        )}
      </div>
    </section>
  )
}

function MethodRow({
  method,
  pendingChanges,
  onToggle,
}: {
  method: PaymentMethod,
  pendingChanges: Record<string, boolean>,
  onToggle: (next: boolean) => void,
}) {
  const isEnabled = method.id in pendingChanges ? pendingChanges[method.id] : method.enabled
  const changed = method.id in pendingChanges
  return (
    <li
      className={cn(
        "flex items-center justify-between gap-4 px-2 py-3 transition-colors",
        changed && "bg-blue-500/5 dark:bg-blue-400/5"
      )}
    >
      <div className="min-w-0">
        <p className="text-sm font-medium">{method.name}</p>
        <p className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
          {method.id}
          {!method.available && " · unavailable"}
        </p>
      </div>
      <Switch
        checked={isEnabled}
        disabled={!method.available}
        onCheckedChange={onToggle}
      />
    </li>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Block new purchases
// ──────────────────────────────────────────────────────────────────────────

function BlockNewPurchasesCard() {
  const project = useAdminProject()
  const config = useLoadedAdminProjectConfig(project)
  const { invalidateProjectConfig } = useStackAuthQueryInvalidation()
  const blocked = Boolean(
    (config as { payments?: { blockNewPurchases?: boolean } }).payments?.blockNewPurchases
  )
  const [pending, setPending] = useState<boolean | null>(null)

  const handleToggle = async (next: boolean) => {
    setPending(next)
    try {
      await project.updateConfig({ "payments.blockNewPurchases": next })
      await invalidateProjectConfig(project.id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update.")
    } finally {
      setPending(null)
    }
  }

  const display = pending ?? blocked

  return (
    <section className="rounded-lg border bg-card">
      <div className="border-b px-5 py-4">
        <h2 className="font-heading text-sm font-semibold">Block new purchases</h2>
        <p className="text-xs text-muted-foreground">
          Stops new checkouts while keeping existing subscriptions active.
        </p>
      </div>
      <div className="flex items-center justify-between gap-4 px-5 py-5">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-md border",
              display ? "border-destructive/30 bg-destructive/10 text-destructive" : "bg-background text-muted-foreground"
            )}
          >
            <ProhibitIcon />
          </span>
          <div>
            <p className="text-sm font-medium">
              {display ? "New purchases are blocked" : "New purchases are allowed"}
            </p>
            {display && (
              <p className="text-xs text-muted-foreground">
                Existing subscriptions continue to renew until cancelled.
              </p>
            )}
          </div>
        </div>
        <Switch
          checked={display}
          disabled={pending != null}
          onCheckedChange={(next) => {
            void handleToggle(next)
          }}
        />
      </div>
    </section>
  )
}

// Suppress unused import warning when Link is needed elsewhere in the future.
void Link
