import { useMemo, useState } from "react"
import { Link, createFileRoute } from "@tanstack/react-router"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  ArrowClockwiseIcon,
  ArrowCounterClockwiseIcon,
  CheckIcon,
  CopyIcon,
  DotsThreeIcon,
  EyeIcon,
  GearIcon,
  PlugIcon,
  ProhibitIcon,
  QuestionIcon,
  ShoppingCartIcon,
  ShuffleIcon,
} from "@phosphor-icons/react"
import { TRANSACTION_TYPES } from "@stackframe/stack-shared/dist/interface/crud/transactions"
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors"
import type { Icon as PhosphorIcon } from "@phosphor-icons/react"
import type {
  Transaction,
  TransactionEntry,
  TransactionType,
} from "@stackframe/stack-shared/dist/interface/crud/transactions"
import type { MoneyAmount } from "@stackframe/stack-shared/dist/utils/currency-constants"

import type { VirtualDataGridColumn } from "@/components/ui/virtual-data-grid"
import { useAdminApp } from "@/lib/stack/admin-app"
import { useStripeAccountInfoQuery } from "@/lib/stack/react-query"
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { ProjectDetailSheet } from "@/components/console/project-detail-sheet"
import { PROJECT_PAGE_HEADER_WITH_NAV_STICKY_TOP_CLASS, ProjectPageMain } from "@/components/console/project-page"
import { VirtualDataGrid } from "@/components/ui/virtual-data-grid"
import { useInfiniteListQuery } from "@/hooks/use-infinite-virtual-list"

const PAGE_SIZE = 20
const BULKY_QUERY_GC_TIME_MS = 2 * 60 * 1000
const TX_ROW_HEIGHT = 52
const TX_TABLE_FRAME_CLASS = "[clip-path:inset(0_round_var(--radius-lg))]"

export const Route = createFileRoute("/_app/projects/$projectId/payments/transactions")({
  component: TransactionsPage,
})

function TransactionsPage() {
  const adminApp = useAdminApp()
  const stripeAccountQuery = useStripeAccountInfoQuery(adminApp)
  const isStripeConnected = stripeAccountQuery.data != null

  if (!isStripeConnected) {
    return (
      <ProjectPageMain>
        <DisconnectedNotice projectId={adminApp.projectId} />
      </ProjectPageMain>
    )
  }

  return (
    <ProjectPageMain className="space-y-6">
      <TransactionsCard />
    </ProjectPageMain>
  )
}

function DisconnectedNotice({ projectId }: { projectId: string }) {
  return (
    <section className="rounded-lg border bg-card">
      <div className="border-b px-5 py-4">
        <h2 className="font-heading text-sm font-semibold">Transactions</h2>
        <p className="text-xs text-muted-foreground">
          Recent purchases, renewals and refunds across all customers.
        </p>
      </div>
      <div className="px-5 py-10">
        <div className="mx-auto flex max-w-sm flex-col items-center text-center">
          <span className="mb-3 flex size-9 items-center justify-center rounded-full border bg-background text-muted-foreground">
            <PlugIcon />
          </span>
          <p className="text-sm font-medium">Stripe is not connected</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Transactions appear here after you connect Stripe and a customer completes a payment.
          </p>
          <Link
            to="/projects/$projectId/payments"
            params={{ projectId }}
            className="mt-4 inline-flex h-8 items-center rounded-md border bg-background px-3 text-xs font-medium transition-colors hover:bg-muted hover:transition-none"
          >
            Connect Stripe
          </Link>
        </div>
      </div>
    </section>
  )
}

function TransactionsCard() {
  const adminApp = useAdminApp()
  const [typeFilter, setTypeFilter] = useState<TransactionType | "all">("all")
  const [selectedTxId, setSelectedTxId] = useState<string | null>(null)
  const [refundTxId, setRefundTxId] = useState<string | null>(null)

  const queryKey = useMemo(
    () => ["transactions", adminApp.projectId, typeFilter] as const,
    [adminApp.projectId, typeFilter]
  )

  const {
    items,
    isLoading,
    isError,
    error,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useInfiniteListQuery<Transaction, string>({
    queryKey,
    queryFn: async ({ pageParam }) => {
      const page = await adminApp.listTransactions({
        limit: PAGE_SIZE,
        cursor: pageParam,
        type: typeFilter === "all" ? undefined : typeFilter,
      })
      return { items: page.transactions, nextCursor: page.nextCursor }
    },
    gcTime: BULKY_QUERY_GC_TIME_MS,
  })

  const selectedTx = selectedTxId == null ? null : (items.find((t) => t.id === selectedTxId) ?? null)
  const refundTx = refundTxId == null ? null : (items.find((t) => t.id === refundTxId) ?? null)

  const showEmpty = !isLoading && !isError && items.length === 0 && !hasNextPage
  const columns = useTransactionColumns({
    onView: setSelectedTxId,
    onRefund: setRefundTxId,
  })

  return (
    <section className="rounded-lg border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
        <div>
          <h2 className="font-heading text-sm font-semibold">Transactions</h2>
          <p className="text-xs text-muted-foreground">
            Recent purchases, renewals and refunds across all customers.
          </p>
        </div>
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

      {isLoading ? (
        <VirtualDataGrid
          columns={columns}
          items={[]}
          getItemKey={(tx) => tx.id}
          rowHeight={TX_ROW_HEIGHT}
          isLoading
          hasNextPage={false}
          isFetchingNextPage={false}
          fetchNextPage={() => {}}
          isSearching={false}
          emptyMessage=""
          frameClassName={TX_TABLE_FRAME_CLASS}
          stickyTopClassName={PROJECT_PAGE_HEADER_WITH_NAV_STICKY_TOP_CLASS}
        />
      ) : isError ? (
        <div className="px-5 py-10 text-center text-sm text-destructive">
          {error instanceof Error ? error.message : "Failed to load transactions."}
        </div>
      ) : showEmpty ? (
        <div className="px-5 py-10 text-center">
          <p className="text-sm text-muted-foreground">No transactions yet.</p>
        </div>
      ) : (
        <VirtualDataGrid
          columns={columns}
          items={items}
          getItemKey={(tx) => tx.id}
          rowHeight={TX_ROW_HEIGHT}
          isLoading={false}
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          fetchNextPage={fetchNextPage}
          isSearching={false}
          emptyMessage="No transactions yet."
          selectedItemKey={selectedTxId}
          onSelectItemKey={setSelectedTxId}
          frameClassName={TX_TABLE_FRAME_CLASS}
          stickyTopClassName={PROJECT_PAGE_HEADER_WITH_NAV_STICKY_TOP_CLASS}
        />
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

function useTransactionColumns({
  onView,
  onRefund,
}: {
  onView: (txId: string) => void,
  onRefund: (txId: string) => void,
}) {
  return useMemo<Array<VirtualDataGridColumn<Transaction, string>>>(
    () => [
      {
        id: "id",
        label: "ID",
        width: "minmax(0,0.75fr)",
        renderCell: (tx) => (
          <code className="min-w-0 truncate font-mono text-[11px]">{tx.id.slice(0, 8)}</code>
        ),
      },
      {
        id: "type",
        label: "Type",
        width: "minmax(0,0.9fr)",
        renderCell: (tx) => {
          const summary = summarize(tx)
          const TypeIcon = summary.typeDisplay.Icon
          return (
            <Badge variant="secondary" className="min-w-0 gap-1">
              <TypeIcon className="size-3 shrink-0" />
              <span className="truncate">{summary.typeDisplay.label}</span>
            </Badge>
          )
        },
      },
      {
        id: "customer",
        label: "Customer",
        width: "minmax(0,1.2fr)",
        renderCell: (tx) => {
          const summary = summarize(tx)
          return (
            <CustomerCell
              customerType={summary.customerType}
              customerId={summary.customerId}
            />
          )
        },
      },
      {
        id: "amount",
        label: "Amount",
        width: "minmax(0,0.7fr)",
        renderCell: (tx) => (
          <span className="min-w-0 truncate text-sm tabular-nums">
            {summarize(tx).amountDisplay}
          </span>
        ),
      },
      {
        id: "status",
        label: "Status",
        width: "minmax(0,0.85fr)",
        renderCell: (tx) => {
          const summary = summarize(tx)
          return <StatusBadge tx={tx} summary={summary} />
        },
      },
      {
        id: "created",
        label: "Created",
        width: "minmax(0,1fr)",
        renderCell: (tx) => (
          <span className="min-w-0 truncate text-xs text-muted-foreground">
            {formatDate(tx.created_at_millis)}
          </span>
        ),
      },
      {
        id: "actions",
        label: "Actions",
        width: "3.5rem",
        headerClassName: "justify-end",
        cellClassName: "justify-end",
        renderCell: (tx) => {
          const summary = summarize(tx)
          return (
            <div onClick={(event) => event.stopPropagation()}>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button variant="ghost" size="icon-sm" aria-label="Actions">
                      <DotsThreeIcon />
                    </Button>
                  }
                />
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => onView(tx.id)}>
                    <EyeIcon />
                    View details
                  </DropdownMenuItem>
                  {summary.refundTarget != null && tx.adjusted_by.length === 0 && !tx.test_mode && (
                    <DropdownMenuItem onClick={() => onRefund(tx.id)}>
                      <ArrowCounterClockwiseIcon />
                      Refund
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )
        },
      },
    ],
    [onRefund, onView]
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

function TransactionDetailSheet({
  transaction,
  open,
  onOpenChange,
}: {
  transaction: Transaction | null,
  open: boolean,
  onOpenChange: (nextOpen: boolean) => void,
}) {
  return (
    <ProjectDetailSheet open={open} onOpenChange={onOpenChange}>
      {transaction == null ? null : (
        <>
          <SheetHeader>
            <SheetTitle className="font-heading text-sm font-semibold">Transaction</SheetTitle>
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
                <span className="text-sm">{formatDate(transaction.created_at_millis)}</span>
              </DetailRow>
              <DetailRow label="Effective">
                <span className="text-sm">{formatDate(transaction.effective_at_millis)}</span>
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
                  <li key={i} className="space-y-1 rounded-md border bg-background p-3">
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
    </ProjectDetailSheet>
  )
}

function DetailSection({ title, children }: { title: string, children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
        {title}
      </h3>
      {children}
    </section>
  )
}

function DetailRow({ label, children }: { label: string, children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] items-center gap-3">
      <span className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
        {label}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

function RefundDialog({
  transaction,
  open,
  onOpenChange,
}: {
  transaction: Transaction | null,
  open: boolean,
  onOpenChange: (nextOpen: boolean) => void,
}) {
  const adminApp = useAdminApp()
  const queryClient = useQueryClient()

  const refundInfo = useMemo(() => {
    if (transaction == null) return null
    return computeFullRefund(transaction)
  }, [transaction])

  const refundMutation = useMutation({
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
      toast.error(err instanceof Error ? err.message : "Failed to issue refund.")
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
              <p className="mt-0.5 font-heading text-lg tabular-nums">${refundInfo.totalUsd}</p>
            </div>
            <ul className="space-y-2">
              {refundInfo.entries.map((entry) => (
                <li
                  key={entry.entryIndex}
                  className="flex items-center justify-between rounded-md border bg-background px-3 py-2 text-xs"
                >
                  <span className="font-mono">entry [{entry.entryIndex}]</span>
                  <span className="tabular-nums">
                    qty {entry.quantity} · ${entry.amountUsd}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={refundMutation.isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={transaction == null || refundInfo == null || refundMutation.isPending}
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

function computeFullRefund(transaction: Transaction): {
  target: RefundTarget,
  entries: Array<RefundEntry>,
  totalUsd: MoneyAmount,
} | null {
  const target = getRefundTarget(transaction)
  if (target == null) return null

  const productGrants = transaction.entries.flatMap((entry, entryIndex) =>
    entry.type === "product_grant" ? [{ entry, entryIndex }] : []
  )
  if (productGrants.length === 0) return null

  const moneyTransfer = transaction.entries.find((e) => e.type === "money_transfer")
  const totalUsd = moneyTransfer == null ? null : extractUsdMoneyAmount(moneyTransfer.charged_amount)
  if (totalUsd == null) {
    return null
  }

  const entries: Array<RefundEntry> = productGrants.map(({ entry, entryIndex }, i) => ({
    entryIndex,
    quantity: entry.quantity,
    amountUsd: i === 0 ? totalUsd : zeroMoneyAmount(),
  }))

  return { target, entries, totalUsd }
}

function zeroMoneyAmount(): MoneyAmount {
  const zero: MoneyAmount = "0"
  return zero
}

function extractUsdMoneyAmount(chargedAmount: unknown): MoneyAmount | null {
  if (typeof chargedAmount !== "object" || chargedAmount == null) return null
  const usd = (chargedAmount as Record<string, unknown>).USD
  return isMoneyAmountString(usd) ? usd : null
}

function isMoneyAmountString(value: unknown): value is MoneyAmount {
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

function normalizeCustomerType(raw: string | null): "user" | "team" | "custom" | null {
  if (raw == null) return null
  if (raw === "user" || raw === "team" || raw === "custom") return raw
  throwErr(`Unexpected customer_type from SDK: ${raw}`)
}

function formatTransactionTypeLabel(t: TransactionType | null): {
  label: string,
  Icon: PhosphorIcon,
} {
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

function CopyableId({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  const onCopy = async () => {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div className="flex min-w-0 items-center gap-2">
      <code className="truncate rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{value}</code>
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
