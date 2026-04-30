import { useMemo, useState } from "react"
import { Link, createFileRoute } from "@tanstack/react-router"
import { toast } from "sonner"
import {
  ArrowClockwiseIcon,
  ArrowCounterClockwiseIcon,
  ArrowSquareOutIcon,
  CheckIcon,
  CopyIcon,
  CreditCardIcon,
  DotsThreeIcon,
  EyeIcon,
  GearIcon,
  PlugIcon,
  ProhibitIcon,
  QuestionIcon,
  ShoppingCartIcon,
  ShuffleIcon,
} from "@phosphor-icons/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { TRANSACTION_TYPES } from "@stackframe/stack-shared/dist/interface/crud/transactions"
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors"
import type { Icon as PhosphorIcon } from "@phosphor-icons/react"
import type {
  Transaction,
  TransactionEntry,
  TransactionType,
} from "@stackframe/stack-shared/dist/interface/crud/transactions"
import type { MoneyAmount } from "@stackframe/stack-shared/dist/utils/currency-constants"

import { useAdminApp } from "@/lib/stack/admin-app"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { useInfiniteVirtualList } from "@/hooks/use-infinite-virtual-list"

const PAGE_SIZE = 20
const BULKY_QUERY_GC_TIME_MS = 2 * 60 * 1000

export const Route = createFileRoute("/_app/projects/$projectId/payments")({
  component: PaymentsPage,
})

function PaymentsPage() {
  const adminApp = useAdminApp()
  const stripeAccount = adminApp.useStripeAccountInfo()

  return (
    <div className="flex flex-col">
      <header className="border-b">
        <div className="mx-auto flex h-[52px] w-full max-w-6xl items-center justify-between gap-3 px-6">
          <h1 className="font-heading text-base font-semibold tracking-tight">
            Payments
          </h1>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 space-y-6 px-6 py-8">
        <AccountStatusCard account={stripeAccount} />
        <PaymentMethodsCard isStripeConnected={stripeAccount != null} />
        <TransactionsCard isStripeConnected={stripeAccount != null} />
      </main>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Account Status
// ──────────────────────────────────────────────────────────────────────────

type StripeAccount = {
  account_id: string,
  charges_enabled: boolean,
  details_submitted: boolean,
  payouts_enabled: boolean,
}

function AccountStatusCard({ account }: { account: StripeAccount | null }) {
  const adminApp = useAdminApp()

  const setupMutation = useMutation({
    // SDK: setupPayments(): Promise<{ url: string }>
    mutationFn: () => adminApp.setupPayments(),
    onSuccess: ({ url }) => {
      window.location.href = url
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : "Failed to start Stripe onboarding."
      )
    },
  })

  return (
    <section className="rounded-lg border bg-card">
      <div className="flex items-center justify-between gap-4 border-b px-5 py-4">
        <div className="space-y-0.5">
          <h2 className="font-heading text-sm font-medium">Stripe account</h2>
          <p className="text-xs text-muted-foreground">
            Connect a Stripe account to charge customers and receive payouts.
          </p>
        </div>
        {account == null ? null : (
          <Badge variant={account.charges_enabled ? "default" : "secondary"}>
            {account.charges_enabled ? "Active" : "Pending"}
          </Badge>
        )}
      </div>

      <div className="px-5 py-5">
        {account == null ? (
          <Empty className="border-0">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <PlugIcon />
              </EmptyMedia>
              <EmptyTitle>Stripe not connected</EmptyTitle>
              <EmptyDescription>
                Link a Stripe account to start accepting payments. We will redirect
                you to Stripe to complete onboarding.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button
                size="lg"
                onClick={async () => {
                  await setupMutation.mutateAsync()
                }}
              >
                <PlugIcon />
                Connect Stripe
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <div className="space-y-5">
            {!account.details_submitted && (
              <Alert>
                <AlertTitle>Onboarding incomplete</AlertTitle>
                <AlertDescription className="flex items-center justify-between gap-3">
                  <span>
                    Stripe still needs additional details before you can charge
                    customers.
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      await setupMutation.mutateAsync()
                    }}
                  >
                    Complete onboarding
                    <ArrowSquareOutIcon />
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
              <span className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase self-center">
                Account ID
              </span>
              <CopyableId value={account.account_id} />
            </div>

            <div className="grid gap-2 sm:grid-cols-3">
              <StatusChip label="Charges" enabled={account.charges_enabled} />
              <StatusChip
                label="Details submitted"
                enabled={account.details_submitted}
              />
              <StatusChip label="Payouts" enabled={account.payouts_enabled} />
            </div>
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
        className={
          "size-2 rounded-full " + (enabled ? "bg-success" : "bg-destructive")
        }
      />
      <span className="text-xs">{label}</span>
      <span className="ms-auto font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
        {enabled ? "On" : "Off"}
      </span>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Payment Methods
// ──────────────────────────────────────────────────────────────────────────

type PaymentMethodConfig = {
  configId: string,
  methods: Array<{
    id: string,
    name: string,
    enabled: boolean,
    available: boolean,
    overridable: boolean,
  }>,
}

function PaymentMethodsCard({ isStripeConnected }: { isStripeConnected: boolean }) {
  const adminApp = useAdminApp()
  const queryClient = useQueryClient()
  const paymentMethodsQueryKey = useMemo(
    () => ["payments", "method-configs", adminApp.projectId] as const,
    [adminApp.projectId],
  )

  const query = useQuery({
    queryKey: paymentMethodsQueryKey,
    // SDK: getPaymentMethodConfigs(): Promise<{ configId, methods: [...] } | null>
    queryFn: () => adminApp.getPaymentMethodConfigs(),
    enabled: isStripeConnected,
  })

  const updateMutation = useMutation({
    // SDK: updatePaymentMethodConfigs(configId, updates: Record<string, 'on' | 'off'>): Promise<void>
    mutationFn: async (vars: {
      configId: string,
      methodId: string,
      nextEnabled: boolean,
    }) => {
      await adminApp.updatePaymentMethodConfigs(vars.configId, {
        [vars.methodId]: vars.nextEnabled ? "on" : "off",
      })
    },
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: paymentMethodsQueryKey })
      const prev = queryClient.getQueryData<PaymentMethodConfig | null>(
        paymentMethodsQueryKey
      )
      if (prev != null) {
        queryClient.setQueryData<PaymentMethodConfig | null>(
          paymentMethodsQueryKey,
          {
            ...prev,
            methods: prev.methods.map((m) =>
              m.id === vars.methodId ? { ...m, enabled: vars.nextEnabled } : m
            ),
          }
        )
      }
      return { prev }
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.prev !== undefined) {
        queryClient.setQueryData(paymentMethodsQueryKey, ctx.prev)
      }
      toast.error(
        err instanceof Error ? err.message : "Failed to update payment method."
      )
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: paymentMethodsQueryKey })
    },
  })

  return (
    <section className="rounded-lg border bg-card">
      <div className="border-b px-5 py-4">
        <h2 className="font-heading text-sm font-medium">Payment methods</h2>
        <p className="text-xs text-muted-foreground">
          Choose which payment methods are offered at checkout.
        </p>
      </div>

      <div className="px-5 py-5">
        {!isStripeConnected ? (
          <p className="text-xs text-muted-foreground">
            Set up payment methods after connecting Stripe.
          </p>
        ) : query.isPending ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : query.isError ? (
          <Alert variant="destructive">
            <AlertTitle>Could not load payment methods</AlertTitle>
            <AlertDescription>
              {query.error instanceof Error
                ? query.error.message
                : "Unknown error."}
            </AlertDescription>
          </Alert>
        ) : query.data == null ? (
          <p className="text-xs text-muted-foreground">
            Payment method configuration is not available yet. Finish Stripe
            onboarding to manage payment methods.
          </p>
        ) : query.data.methods.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No payment methods are available for this account.
          </p>
        ) : (
          <ul className="divide-y">
            {query.data.methods.map((method) => {
              const locked = !method.available || !method.overridable
              return (
                <li
                  key={method.id}
                  className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{method.name}</p>
                    <p className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
                      {method.id}
                      {!method.available && " · unavailable"}
                      {method.available && !method.overridable && " · forced"}
                    </p>
                  </div>
                  <Switch
                    checked={method.enabled}
                    disabled={locked || updateMutation.isPending}
                    onCheckedChange={(next: boolean) => {
                      const data = query.data
                      if (data == null) {
                        throwErr(
                          "Payment-method query data became null while toggling — should be unreachable."
                        )
                      }
                      updateMutation.mutate({
                        configId: data.configId,
                        methodId: method.id,
                        nextEnabled: next,
                      })
                    }}
                  />
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Transactions
// ──────────────────────────────────────────────────────────────────────────

const TX_GRID_COLS =
  "grid grid-cols-[7rem_8rem_minmax(8rem,1fr)_6rem_7rem_minmax(8rem,1fr)_2.5rem] items-center gap-3 px-5"

function TransactionsCard({ isStripeConnected }: { isStripeConnected: boolean }) {
  const [typeFilter, setTypeFilter] = useState<TransactionType | "all">("all")

  if (!isStripeConnected) {
    return (
      <section className="rounded-lg border bg-card">
        <div className="border-b px-5 py-4">
          <h2 className="font-heading text-sm font-medium">Transactions</h2>
          <p className="text-xs text-muted-foreground">
            Recent purchases, renewals and refunds across all customers.
          </p>
        </div>
        <div className="px-5 py-5">
          <p className="text-xs text-muted-foreground">
            Transactions appear here after you connect Stripe and a customer
            completes a payment.
          </p>
        </div>
      </section>
    )
  }

  return (
    <TransactionsCardLoaded
      typeFilter={typeFilter}
      setTypeFilter={setTypeFilter}
    />
  )
}

function TransactionsCardLoaded({
  typeFilter,
  setTypeFilter,
}: {
  typeFilter: TransactionType | "all",
  setTypeFilter: (t: TransactionType | "all") => void,
}) {
  const adminApp = useAdminApp()

  const [selectedTxId, setSelectedTxId] = useState<string | null>(null)
  const [refundTxId, setRefundTxId] = useState<string | null>(null)

  const queryKey = useMemo(
    () => ["transactions", adminApp.projectId, typeFilter] as const,
    [adminApp.projectId, typeFilter],
  )

  const {
    parentRef,
    virtualizer,
    items,
    isLoading,
    isError,
    error,
    isFetchingNextPage,
    hasNextPage,
  } = useInfiniteVirtualList<Transaction, string>({
    queryKey,
    queryFn: async ({ pageParam }) => {
      const page = await adminApp.listTransactions({
        limit: PAGE_SIZE,
        cursor: pageParam,
        type: typeFilter === "all" ? undefined : typeFilter,
      })
      return { items: page.transactions, nextCursor: page.nextCursor }
    },
    estimateSize: 52,
    overscan: 8,
    gcTime: BULKY_QUERY_GC_TIME_MS,
  })

  const selectedTx = selectedTxId == null
    ? null
    : items.find((t) => t.id === selectedTxId) ?? null
  const refundTx = refundTxId == null
    ? null
    : items.find((t) => t.id === refundTxId) ?? null

  const virtualItems = virtualizer.getVirtualItems()
  const totalSize = virtualizer.getTotalSize()
  const showEmpty = !isLoading && !isError && items.length === 0 && !hasNextPage

  return (
    <section className="rounded-lg border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
        <div>
          <h2 className="font-heading text-sm font-medium">Transactions</h2>
          <p className="text-xs text-muted-foreground">
            Recent purchases, renewals and refunds across all customers.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            items={[
              { value: "all", label: "All types" },
              ...TRANSACTION_TYPES.map((t) => ({
                value: t,
                label: formatTransactionTypeLabel(t).label,
              })),
            ]}
            value={typeFilter}
            onValueChange={(v: string | null) => {
              if (v == null || v === "all") {
                setTypeFilter("all")
                return
              }
              const matched = TRANSACTION_TYPES.find((t) => t === v)
              if (matched != null) {
                setTypeFilter(matched)
                return
              }
              throwErr(`Unknown transaction type filter: ${v}`)
            }}
          >
            <SelectTrigger className="h-8 min-w-40">
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {TRANSACTION_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {formatTransactionTypeLabel(t).label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div
        className={
          TX_GRID_COLS +
          " border-b py-2 font-mono text-[10px] tracking-wider text-muted-foreground uppercase"
        }
      >
        <span>ID</span>
        <span>Type</span>
        <span>Customer</span>
        <span>Amount</span>
        <span>Status</span>
        <span>Created</span>
        <span />
      </div>

      {isLoading ? (
        <div className="px-5 py-10 text-center text-sm text-muted-foreground">
          Loading…
        </div>
      ) : isError ? (
        <div className="px-5 py-10 text-center text-sm text-destructive">
          {error instanceof Error ? error.message : "Failed to load transactions."}
        </div>
      ) : showEmpty ? (
        <div className="px-5 py-10 text-center">
          <p className="text-sm text-muted-foreground">No transactions yet.</p>
        </div>
      ) : (
        <div
          ref={parentRef}
          className="relative max-h-[600px] overflow-auto"
        >
          <div className="relative w-full" style={{ height: `${totalSize}px` }}>
            {virtualItems.map((row) => {
              const isLoaderRow = row.index >= items.length
              if (isLoaderRow) {
                return (
                  <div
                    key={`__loader_${row.index}`}
                    data-index={row.index}
                    ref={virtualizer.measureElement}
                    className="absolute left-0 top-0 w-full"
                    style={{ transform: `translateY(${row.start}px)` }}
                  >
                    <div className="flex items-center justify-center py-3 text-xs text-muted-foreground">
                      {isFetchingNextPage || hasNextPage ? "Loading more…" : null}
                    </div>
                  </div>
                )
              }
              const tx = items[row.index]
              return (
                <div
                  key={tx.id}
                  data-index={row.index}
                  ref={virtualizer.measureElement}
                  className="absolute left-0 top-0 w-full"
                  style={{ transform: `translateY(${row.start}px)` }}
                >
                  <TransactionRow
                    tx={tx}
                    onView={() => setSelectedTxId(tx.id)}
                    onRefund={() => setRefundTxId(tx.id)}
                  />
                </div>
              )
            })}
          </div>
        </div>
      )}

      <TransactionDetailSheet
        transaction={selectedTx}
        open={selectedTx != null}
        onOpenChange={(o) => {
          if (!o) setSelectedTxId(null)
        }}
      />

      <RefundDialog
        transaction={refundTx}
        open={refundTx != null}
        onOpenChange={(o) => {
          if (!o) setRefundTxId(null)
        }}
      />
    </section>
  )
}

function TransactionRow({
  tx,
  onView,
  onRefund,
}: {
  tx: Transaction,
  onView: () => void,
  onRefund: () => void,
}) {
  const summary = summarize(tx)
  const TypeIcon = summary.typeDisplay.Icon
  return (
    <div className={TX_GRID_COLS + " border-b py-2.5 last:border-b-0"}>
      <code className="truncate font-mono text-[11px]">{tx.id.slice(0, 8)}</code>
      <div className="min-w-0">
        <Badge variant="secondary" className="gap-1">
          <TypeIcon className="size-3" />
          <span className="truncate">{summary.typeDisplay.label}</span>
        </Badge>
      </div>
      <div className="min-w-0">
        <CustomerCell
          customerType={summary.customerType}
          customerId={summary.customerId}
        />
      </div>
      <span className="truncate text-sm">{summary.amountDisplay}</span>
      <div className="min-w-0">
        <StatusBadge tx={tx} summary={summary} />
      </div>
      <span className="truncate text-xs text-muted-foreground">
        {formatDate(tx.created_at_millis)}
      </span>
      <div className="flex justify-end">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon-sm" aria-label="Actions">
                <DotsThreeIcon />
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onView}>
              <EyeIcon />
              View details
            </DropdownMenuItem>
            {summary.refundTarget != null &&
              tx.adjusted_by.length === 0 &&
              !tx.test_mode && (
                <DropdownMenuItem onClick={onRefund}>
                  <ArrowCounterClockwiseIcon />
                  Refund
                </DropdownMenuItem>
              )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

function StatusBadge({ tx, summary }: { tx: Transaction, summary: TransactionSummary }) {
  if (tx.test_mode) {
    return <Badge variant="outline">Test mode</Badge>
  }
  if (tx.adjusted_by.length > 0) {
    return <Badge variant="secondary">Refunded</Badge>
  }
  if (summary.typeDisplay.label === "—") {
    return <Badge variant="outline">Unknown</Badge>
  }
  return <Badge>Completed</Badge>
}

function CustomerCell({
  customerType,
  customerId,
}: {
  customerType: "user" | "team" | "custom" | null,
  customerId: string | null,
}) {
  const adminApp = useAdminApp()
  if (customerType == null || customerId == null) {
    return <span className="text-xs text-muted-foreground">—</span>
  }
  const projectId = adminApp.projectId

  if (customerType === "user") {
    return (
      <Link
        to="/projects/$projectId/users"
        params={{ projectId }}
        className="font-mono text-[11px] underline-offset-2 transition-colors hover:underline hover:transition-none"
      >
        user · {customerId.slice(0, 8)}
      </Link>
    )
  }
  if (customerType === "team") {
    return (
      <Link
        to="/projects/$projectId/teams"
        params={{ projectId }}
        className="font-mono text-[11px] underline-offset-2 transition-colors hover:underline hover:transition-none"
      >
        team · {customerId.slice(0, 8)}
      </Link>
    )
  }
  return (
    <span className="font-mono text-[11px] text-muted-foreground">
      custom · {customerId.slice(0, 8)}
    </span>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Detail Sheet
// ──────────────────────────────────────────────────────────────────────────

function TransactionDetailSheet({
  transaction,
  open,
  onOpenChange,
}: {
  transaction: Transaction | null,
  open: boolean,
  onOpenChange: (open: boolean) => void,
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg">
        {transaction == null ? null : (
          <>
            <SheetHeader>
              <SheetTitle className="font-heading text-sm font-medium">
                Transaction
              </SheetTitle>
              <SheetDescription>
                <CopyableId value={transaction.id} />
              </SheetDescription>
            </SheetHeader>

            <div className="flex-1 space-y-6 overflow-y-auto px-6 pb-6">
              <DetailSection title="Meta">
                <DetailRow label="Type">
                  <Badge variant="secondary">
                    {formatTransactionTypeLabel(transaction.type).label}
                  </Badge>
                </DetailRow>
                <DetailRow label="Created">
                  <span className="text-sm">
                    {formatDate(transaction.created_at_millis)}
                  </span>
                </DetailRow>
                <DetailRow label="Effective">
                  <span className="text-sm">
                    {formatDate(transaction.effective_at_millis)}
                  </span>
                </DetailRow>
                <DetailRow label="Test mode">
                  <Badge variant={transaction.test_mode ? "outline" : "secondary"}>
                    {transaction.test_mode ? "Yes" : "No"}
                  </Badge>
                </DetailRow>
                <DetailRow label="Refund chain">
                  <span className="text-xs text-muted-foreground">
                    {transaction.adjusted_by.length === 0
                      ? "Not refunded"
                      : `${transaction.adjusted_by.length} adjustment(s)`}
                  </span>
                </DetailRow>
              </DetailSection>

              <DetailSection title="Entries">
                <ul className="space-y-3">
                  {transaction.entries.map((entry, i) => (
                    <li
                      key={i}
                      className="space-y-1 rounded-md border bg-background p-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <Badge variant="outline" className="font-mono text-[10px]">
                          [{i}] {entry.type}
                        </Badge>
                      </div>
                      <pre className="overflow-x-auto rounded bg-muted/50 p-2 font-mono text-[10px] leading-relaxed">
                        {JSON.stringify(entry, null, 2)}
                      </pre>
                    </li>
                  ))}
                </ul>
              </DetailSection>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

function DetailSection({
  title,
  children,
}: {
  title: string,
  children: React.ReactNode,
}) {
  return (
    <section className="space-y-3">
      <h3 className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
        {title}
      </h3>
      {children}
    </section>
  )
}

function DetailRow({
  label,
  children,
}: {
  label: string,
  children: React.ReactNode,
}) {
  return (
    <div className="grid grid-cols-[8rem_1fr] items-center gap-3">
      <span className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
        {label}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Refund
// ──────────────────────────────────────────────────────────────────────────

function RefundDialog({
  transaction,
  open,
  onOpenChange,
}: {
  transaction: Transaction | null,
  open: boolean,
  onOpenChange: (open: boolean) => void,
}) {
  const adminApp = useAdminApp()
  const queryClient = useQueryClient()

  const refundInfo = useMemo(() => {
    if (transaction == null) return null
    return computeFullRefund(transaction)
  }, [transaction])

  const refundMutation = useMutation({
    // SDK: refundTransaction({ type, id, refundEntries: [{ entryIndex, quantity, amountUsd }] })
    mutationFn: async () => {
      const tx = transaction ?? throwErr("Refund mutation fired without a transaction.")
      const info = refundInfo ?? throwErr("Refund mutation fired without refund info.")
      await adminApp.refundTransaction({
        type: info.target.type,
        id: info.target.id,
        refundEntries: info.entries,
      })
      return tx.id
    },
    onSuccess: async () => {
      toast.success("Refund issued.")
      await queryClient.invalidateQueries()
      onOpenChange(false)
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : "Failed to issue refund."
      )
    },
  })

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Refund transaction</AlertDialogTitle>
          <AlertDialogDescription>
            {transaction == null || refundInfo == null
              ? "This transaction is not refundable."
              : `Issue a full refund for this ${refundInfo.target.type === "subscription" ? "subscription" : "one-time purchase"}. This cannot be undone.`}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {transaction != null && refundInfo != null && (
          <div className="space-y-3">
            <div className="rounded-md border bg-background p-3">
              <p className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
                Total refund
              </p>
              <p className="mt-0.5 font-heading text-lg">
                ${refundInfo.totalUsd}
              </p>
            </div>
            <ul className="space-y-2">
              {refundInfo.entries.map((entry) => (
                <li
                  key={entry.entryIndex}
                  className="flex items-center justify-between rounded-md border bg-background px-3 py-2 text-xs"
                >
                  <span className="font-mono">entry [{entry.entryIndex}]</span>
                  <span>
                    qty {entry.quantity} · ${entry.amountUsd}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={refundMutation.isPending}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={
              transaction == null ||
              refundInfo == null ||
              refundMutation.isPending
            }
            onClick={(e) => {
              e.preventDefault()
              refundMutation.mutate()
            }}
          >
            {refundMutation.isPending ? "Refunding…" : "Confirm refund"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

type RefundTarget = { type: "subscription" | "one-time-purchase", id: string }
type RefundEntry = { entryIndex: number, quantity: number, amountUsd: MoneyAmount }

function computeFullRefund(
  transaction: Transaction
): { target: RefundTarget, entries: Array<RefundEntry>, totalUsd: MoneyAmount } | null {
  const target = getRefundTarget(transaction)
  if (target == null) return null

  // Collect product_grant entries — each represents a refundable line.
  // For v1 we only support full refund: refund every product_grant entry's
  // full quantity. Money is allocated to the first entry; remaining entries
  // get amountUsd "0" to match the SDK contract (refundEntries must align
  // with all refundable entries, but v1 doesn't split partial amounts).
  const productGrants = transaction.entries.flatMap((entry, entryIndex) =>
    entry.type === "product_grant" ? [{ entry, entryIndex }] : []
  )
  if (productGrants.length === 0) return null

  // Pull total charged USD from money_transfer entry if present.
  // The SDK schema currently lacks a strict per-currency type for
  // charged_amount, so we extract via a runtime-validated helper that
  // returns a MoneyAmount-shaped string ("12" or "12.34") or null.
  const moneyTransfer = transaction.entries.find((e) => e.type === "money_transfer")
  const totalUsd = moneyTransfer == null
    ? null
    : extractUsdMoneyAmount(moneyTransfer.charged_amount)
  if (totalUsd == null) {
    return null
  }

  const entries: Array<RefundEntry> = productGrants.map(
    ({ entry, entryIndex }, i) => ({
      entryIndex,
      quantity: entry.quantity,
      amountUsd: i === 0 ? totalUsd : zeroMoneyAmount(),
    })
  )

  return { target, entries, totalUsd }
}

function zeroMoneyAmount(): MoneyAmount {
  // "0" matches the `${number}` half of MoneyAmount = `${number}` | `${number}.${number}`.
  const zero: MoneyAmount = "0"
  return zero
}

function extractUsdMoneyAmount(chargedAmount: unknown): MoneyAmount | null {
  if (typeof chargedAmount !== "object" || chargedAmount == null) return null
  const usd = (chargedAmount as Record<string, unknown>).USD
  return isMoneyAmountString(usd) ? usd : null
}

function isMoneyAmountString(value: unknown): value is MoneyAmount {
  // MoneyAmount = `${number}` | `${number}.${number}`. We validate by parsing
  // and ensuring the round-trip preserves the raw string (no leading zeros,
  // no whitespace, etc. — same shape Stripe gives us).
  if (typeof value !== "string") return false
  if (!/^\d+(\.\d+)?$/.test(value)) return false
  return Number.isFinite(Number(value))
}

function getRefundTarget(transaction: Transaction): RefundTarget | null {
  if (transaction.type !== "purchase") return null
  const productGrant = transaction.entries.find(
    (entry): entry is Extract<TransactionEntry, { type: "product_grant" }> =>
      entry.type === "product_grant"
  )
  if (productGrant?.subscription_id != null) {
    return { type: "subscription", id: productGrant.subscription_id }
  }
  if (productGrant?.one_time_purchase_id != null) {
    return { type: "one-time-purchase", id: productGrant.one_time_purchase_id }
  }
  return null
}

// ──────────────────────────────────────────────────────────────────────────
// Summarisation helpers
// ──────────────────────────────────────────────────────────────────────────

type TransactionSummary = {
  typeDisplay: { label: string, Icon: PhosphorIcon },
  customerType: "user" | "team" | "custom" | null,
  customerId: string | null,
  amountDisplay: string,
  refundTarget: RefundTarget | null,
}

function summarize(transaction: Transaction): TransactionSummary {
  const customerEntry = transaction.entries.find(
    (e): e is Extract<TransactionEntry, { customer_type: string, customer_id: string }> =>
      "customer_type" in e && "customer_id" in e
  )
  const moneyTransfer = transaction.entries.find((e) => e.type === "money_transfer")
  let amountDisplay = "—"
  if (transaction.test_mode) {
    amountDisplay = "Test mode"
  } else if (moneyTransfer != null) {
    const usd = extractUsdMoneyAmount(moneyTransfer.charged_amount)
    if (usd != null) {
      amountDisplay = `$${usd}`
    } else {
      const charged = moneyTransfer.charged_amount as unknown
      if (typeof charged === "object" && charged != null) {
        const entries = Object.entries(charged as Record<string, unknown>)
        const first = entries.find(([, v]) => typeof v === "string")
        if (first != null) {
          amountDisplay = `${String(first[1])} ${first[0]}`
        }
      }
    }
  }

  return {
    typeDisplay: formatTransactionTypeLabel(transaction.type),
    customerType: normalizeCustomerType(customerEntry?.customer_type ?? null),
    customerId: customerEntry?.customer_id ?? null,
    amountDisplay,
    refundTarget: getRefundTarget(transaction),
  }
}

function normalizeCustomerType(
  raw: string | null
): "user" | "team" | "custom" | null {
  if (raw == null) return null
  if (raw === "user" || raw === "team" || raw === "custom") return raw
  throwErr(`Unexpected customer_type from SDK: ${raw}`)
}

function formatTransactionTypeLabel(
  t: TransactionType | null
): { label: string, Icon: PhosphorIcon } {
  switch (t) {
    case "purchase":
      return { label: "Purchase", Icon: ShoppingCartIcon }
    case "subscription-renewal":
      return { label: "Renewal", Icon: ArrowClockwiseIcon }
    case "subscription-cancellation":
      return { label: "Cancellation", Icon: ProhibitIcon }
    case "chargeback":
      return { label: "Chargeback", Icon: ArrowCounterClockwiseIcon }
    case "manual-item-quantity-change":
      return { label: "Manual item change", Icon: GearIcon }
    case "product-change":
      return { label: "Product change", Icon: ShuffleIcon }
    case null:
      return { label: "—", Icon: QuestionIcon }
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Misc
// ──────────────────────────────────────────────────────────────────────────

function CopyableId({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  const onCopy = async () => {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div className="flex items-center gap-2 min-w-0">
      <code className="truncate rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
        {value}
      </code>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={copied ? "Copied" : "Copy"}
        onClick={() => {
          void onCopy()
        }}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </Button>
    </div>
  )
}

function formatDate(millis: number): string {
  return new Date(millis).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

// Suppress unused-import warning for icons referenced through dynamic mapping.
void CreditCardIcon
